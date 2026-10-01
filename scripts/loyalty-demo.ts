/** Explicit, idempotent fixture for the verified disposable Docker database only. */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV === "production" || process.env.VERCEL || url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/bazaar_feature_20261001" || url.username !== "bazaar_test") throw new Error("Demo requires the isolated bazaar_feature_20261001 database on 127.0.0.1:55432.");
  const docker = JSON.parse(execFileSync("docker", ["inspect", "bazaar-stabilization-postgres-1"], { encoding: "utf8" }))[0];
  if (docker.Config.Labels["bazaar.test-purpose"] !== "disposable-stabilization" || !Object.hasOwn(docker.HostConfig.Tmpfs, "/var/lib/postgresql/data") || !docker.NetworkSettings.Ports["5432/tcp"].some((p: {HostIp: string; HostPort: string}) => p.HostIp === "127.0.0.1" && p.HostPort === "55432")) throw new Error("Disposable PostgreSQL identity could not be verified.");
  if (process.env.EMAIL_PROVIDER !== "log" || process.env.HARDENING_EXTERNAL_PROVIDER_MODE !== "disabled") throw new Error("External providers must be disabled and mail must use log.");
  const password = process.env.BAZAAR_DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set BAZAAR_DEMO_PASSWORD (at least 12 characters). No password is hardcoded or reset on repeat runs.");
  const { prisma } = await import("../src/server/db/prisma");
  const { appRouter } = await import("../src/server/trpc/routers/_app");
  const { getLogger } = await import("../src/server/logging");
  const { upsertLoyaltyProgram } = await import("../src/server/services/loyalty/program");
  const { applyEntry, ensureAccount } = await import("../src/server/services/loyalty/ledger");
  const { upsertBazaarCatalogSettings } = await import("../src/server/services/bazaarCatalog");
  try {
    const organizationId = "local-feature-acceptance-20261001";
    const existing = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (existing && existing.name !== "Bazaar · учебная приёмка 01.10.2026") throw new Error("Fixture organization identity mismatch.");
    await prisma.organization.upsert({ where: { id: organizationId }, create: { id: organizationId, name: "Bazaar · учебная приёмка 01.10.2026", plan: "ENTERPRISE", retailWholesaleEnabled: true }, update: {} });
    const stores = [];
    for (const [code, name] of [["DEMO-A", "Учебный · Центр"], ["DEMO-B", "Учебный · Склад"]] as const) {
      stores.push(await prisma.store.upsert({ where: { organizationId_code: { organizationId, code } }, create: { organizationId, code, name }, update: {} }));
    }
    const users = [];
    for (const [login, role, transfer] of [["owner", "ADMIN", true], ["manager", "MANAGER", true], ["cashier", "CASHIER", true], ["limited", "CASHIER", false]] as const) {
      const email = `demo.${login}@bazaar.invalid`;
      const old = await prisma.user.findUnique({ where: { email } });
      if (old && old.organizationId !== organizationId) throw new Error("Fixture email belongs to another organization.");
      const user = await prisma.user.upsert({ where: { email }, create: { organizationId, email, name: `Учебный ${login}`, role, isOrgOwner: role === "ADMIN", passwordHash: await bcrypt.hash(password, 10), emailVerifiedAt: new Date(), canTransferStock: transfer }, update: {} });
      users.push(user);
      await prisma.userStoreAccess.createMany({ data: stores.map(store => ({ organizationId, userId: user.id, storeId: store.id })), skipDuplicates: true });
      await prisma.userGuideState.upsert({ where: { userId: user.id }, create: { userId: user.id, completedToursJson: [], dismissedTipsJson: ["__guidance:tours_disabled__"] }, update: {} });
    }
    const owner = users[0]; const store = stores[0];
    const api = appRouter.createCaller({ prisma, user: { ...owner, isPlatformOwner: false }, impersonator: null, impersonationSessionId: null, ip: "127.0.0.1", requestId: "local-feature-fixture", logger: getLogger("local-feature-fixture") });
    const unit = await prisma.unit.upsert({ where: { organizationId_code: { organizationId, code: "each" } }, create: { organizationId, code: "each", labelRu: "шт", labelKg: "даана" }, update: {} });
    const products = [];
    for (const [sku, name, price, retail, wholesale] of [["DEMO-1000", "Учебный товар · 1000 сом", 1000, 1000, 800], ["DEMO-ZERO", "Образец с нулевой розничной ценой", 500, 0, null], ["DEMO-FALLBACK", "Наследуемая цена · null", 700, null, 600], ["DEMO-VARIANT", "Смеситель · варианты", 1000, null, null], ["DEMO-NOCOST", "Нет себестоимости · нулевой остаток", 90, null, null]] as const) {
      const product = await prisma.product.upsert({ where: { organizationId_sku: { organizationId, sku } }, create: { organizationId, sku, name, baseUnitId: unit.id, unit: unit.code, basePriceKgs: price }, update: {} });
      products.push(product);
      await prisma.storeProduct.createMany({ data: stores.map(s => ({ organizationId, productId: product.id, storeId: s.id, isActive: true, isDirect: true })), skipDuplicates: true });
      await prisma.storePriceTypes.upsert({ where: { organizationId_storeId_productId_variantKey: { organizationId, storeId: store.id, productId: product.id, variantKey: "BASE" } }, create: { organizationId, storeId: store.id, productId: product.id, retailPriceKgs: retail, wholesalePriceKgs: wholesale }, update: {} });
      if (sku !== "DEMO-NOCOST") await api.inventory.postStockReceiving({ storeId: store.id, lines: [{ productId: product.id, quantity: 200, unitCost: 50 }], note: "Начальный учебный остаток", idempotencyKey: `local-fixture-stock:${product.id}` });
    }
    await prisma.productBarcode.createMany({ data: [{ organizationId, productId: products[0].id, value: "0001234567895" }], skipDuplicates: true });
    const variants = [];
    for (const [name, wholesale] of [["Хром", 850], ["Чёрный", 0]] as const) {
      const product = products[3]; const id = `${organizationId}-${name === "Хром" ? "chrome" : "black"}`;
      const variant = await prisma.productVariant.upsert({ where: { id }, create: { id, productId: product.id, name, attributes: { color: name } }, update: {} });
      variants.push(variant);
      await prisma.storePriceTypes.upsert({ where: { organizationId_storeId_productId_variantKey: { organizationId, storeId: store.id, productId: product.id, variantKey: id } }, create: { organizationId, storeId: store.id, productId: product.id, variantId: id, variantKey: id, retailPriceKgs: 1100, wholesalePriceKgs: wholesale }, update: {} });
      await api.inventory.postStockReceiving({ storeId: store.id, lines: [{ productId: product.id, variantId: id, quantity: 50, unitCost: 50 }], note: "Учебные варианты", idempotencyKey: `local-fixture-stock:${id}` });
    }
    const program = await prisma.loyaltyProgram.findUnique({ where: { organizationId } }) ?? await upsertLoyaltyProgram(prisma, organizationId, { enabled: true, storeIds: [store.id] });
    const members = [];
    for (const [login, openingPoints] of [["points", 1000], ["zero", 0]] as const) {
      const email = `buyer.${login}@bazaar.invalid`;
      const customer = await prisma.customer.findFirst({ where: { organizationId, email } }) ?? await prisma.customer.create({ data: { organizationId, storeId: store.id, email, name: `Учебный покупатель · ${openingPoints}` } });
      const member = await prisma.loyaltyMember.upsert({ where: { programId_contactKey: { programId: program.id, contactKey: `email:${email}` } }, create: { organizationId, programId: program.id, contactKey: `email:${email}`, email, customerId: customer.id, displayName: customer.name }, update: {} });
      const account = await ensureAccount(prisma, { organizationId, programId: program.id, memberId: member.id });
      if (openingPoints) await prisma.$transaction(tx => applyEntry(tx, { organizationId, programId: program.id, accountId: account.id, memberId: member.id, type: "ADJUSTMENT", points: openingPoints, eventKey: `local-fixture-opening:${member.id}`, reason: "localDemoOpeningBalance" }));
      members.push({ email, memberId: member.id, customerId: customer.id, balancePoints: (await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } })).balancePoints });
    }
    const register = await prisma.posRegister.findUnique({ where: { storeId_code: { storeId: store.id, code: "DEMO" } } }) ?? await api.pos.registers.create({ storeId: store.id, code: "DEMO", name: "Учебная касса" });
    const shift = await prisma.registerShift.findFirst({ where: { registerId: register.id } });
    if (!shift) await api.pos.shifts.open({ registerId: register.id, openingCashKgs: 0, idempotencyKey: "local-fixture-first-shift" });
    const secondRegister = await prisma.posRegister.findUnique({ where: { storeId_code: { storeId: stores[1].id, code: "DEMO" } } }) ?? await api.pos.registers.create({ storeId: stores[1].id, code: "DEMO", name: "Учебная касса склада" });
    if (!(await prisma.registerShift.findFirst({ where: { registerId: secondRegister.id } }))) await api.pos.shifts.open({ registerId: secondRegister.id, openingCashKgs: 0, idempotencyKey: "local-fixture-second-store-shift" });
    await api.inventory.postStockReceiving({ storeId: stores[1].id, lines: [{ productId: products[0].id, quantity: 100, unitCost: 50 }], note: "Учебный склад", idempotencyKey: "local-fixture-second-store-stock" });
    const catalog = await prisma.bazaarCatalog.findUnique({ where: { storeId: store.id } }) ?? (await upsertBazaarCatalogSettings({ organizationId, storeId: store.id, actorId: owner.id, requestId: "local-feature-fixture", status: "PUBLISHED" })).catalog;
    const link = await prisma.loyaltyProgramStore.findFirstOrThrow({ where: { programId: program.id, storeId: store.id } });
    const result = { organizationId, users: users.map(u => ({ email: u.email, role: u.role, transfer: u.canTransferStock })), stores: stores.map(s => ({ id: s.id, name: s.name })), registerId: register.id, secondRegisterId: secondRegister.id, products: products.map(p => ({ id: p.id, sku: p.sku })), variants, members, joinPath: `/loyalty/join/${link.id}`, catalogPath: `/c/${catalog.slug}`, otpOutbox: "tmp/loyalty-otp-outbox.log" };
    await mkdir("tmp/feature-audit", { recursive: true });
    await writeFile("tmp/feature-audit/demo.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : "Fixture failed"); process.exit(1); });

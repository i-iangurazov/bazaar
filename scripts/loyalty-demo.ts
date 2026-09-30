/**
 * Repeatable loyalty demo setup for a LOCAL database only.
 *
 * Refuses to run against anything that is not localhost, and never resets data.
 * Balances are created through the journal, never by writing the balance column.
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to seed the loyalty demo in production.");
  }
  const host = new URL(url).hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed a non-local database host: ${host}`);
  }
  return host;
}

async function main() {
  const host = assertLocalDatabase();
  const admin = await prisma.user.findUnique({ where: { email: "admin@example.com" } });
  if (!admin?.organizationId) {
    throw new Error("Seed the demo users first: pnpm prisma:seed");
  }
  const organizationId = admin.organizationId;
  const store = await prisma.store.findFirstOrThrow({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  const unit =
    (await prisma.unit.findFirst({ where: { organizationId } })) ??
    (await prisma.unit.create({ data: { organizationId, code: "each", labelRu: "шт", labelKg: "даана" } }));

  const program = await prisma.loyaltyProgram.upsert({
    where: { organizationId },
    create: { organizationId, enabled: true, memberDiscountPercent: 5, earnPercent: 5, maxSpendPercent: 50, pointValueKgs: 1 },
    update: { enabled: true, memberDiscountPercent: 5, earnPercent: 5, maxSpendPercent: 50, pointValueKgs: 1 },
  });
  await prisma.loyaltyProgramStore.upsert({
    where: { programId_storeId: { programId: program.id, storeId: store.id } },
    create: { organizationId, programId: program.id, storeId: store.id },
    update: {},
  });
  const link = await prisma.loyaltyProgramStore.findFirstOrThrow({
    where: { programId: program.id, storeId: store.id },
  });

  // Demo product at exactly 1000 KGS.
  const product = await prisma.product.upsert({
    where: { organizationId_sku: { organizationId, sku: "DEMO-1000" } },
    create: {
      organizationId,
      sku: "DEMO-1000",
      name: "Демо товар 1000 сом",
      unit: unit.code,
      baseUnitId: unit.id,
      basePriceKgs: new Prisma.Decimal(1000),
    },
    update: { name: "Демо товар 1000 сом", basePriceKgs: new Prisma.Decimal(1000) },
  });
  await prisma.storeProduct.upsert({
    where: { storeId_productId: { storeId: store.id, productId: product.id } },
    create: { organizationId, storeId: store.id, productId: product.id, isActive: true, isDirect: true },
    update: { isActive: true },
  });
  await prisma.inventorySnapshot.upsert({
    where: { storeId_productId_variantKey: { storeId: store.id, productId: product.id, variantKey: "BASE" } },
    create: { storeId: store.id, productId: product.id, variantKey: "BASE", onHand: 1000 },
    update: {},
  });

  const ensureMember = async (email: string, openingPoints: number) => {
    const contactKey = `email:${email}`;
    const member = await prisma.loyaltyMember.upsert({
      where: { programId_contactKey: { programId: program.id, contactKey } },
      create: { organizationId, programId: program.id, contactKey, email },
      update: { email },
    });
    const account = await prisma.loyaltyAccount.upsert({
      where: { memberId: member.id },
      create: { organizationId, programId: program.id, memberId: member.id },
      update: {},
    });
    if (openingPoints > 0) {
      const eventKey = `demo:opening:${member.id}`;
      const existing = await prisma.loyaltyLedgerEntry.findUnique({ where: { eventKey } });
      if (!existing) {
        await prisma.$transaction(async (tx) => {
          await tx.loyaltyLedgerEntry.create({
            data: {
              organizationId,
              programId: program.id,
              accountId: account.id,
              memberId: member.id,
              type: "ADJUSTMENT",
              points: openingPoints,
              balanceAfter: account.balancePoints + openingPoints,
              reason: "demoOpeningBalance",
              eventKey,
              actorType: "SYSTEM",
            },
          });
          await tx.loyaltyAccount.update({
            where: { id: account.id },
            data: { balancePoints: { increment: openingPoints } },
          });
        });
      }
    }
    const fresh = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } });
    return { member, account: fresh };
  };

  const cashback = await ensureMember("demo-points@example.invalid", 1000);
  const fresh = await ensureMember("demo-nopoints@example.invalid", 0);

  console.log(
    JSON.stringify(
      {
        host,
        organizationId,
        store: { id: store.id, name: store.name },
        product: { id: product.id, sku: product.sku, priceKgs: 1000 },
        joinPath: `/loyalty/join/${link.id}`,
        members: {
          withPoints: { email: "demo-points@example.invalid", balancePoints: cashback.account.balancePoints },
          withoutPoints: { email: "demo-nopoints@example.invalid", balancePoints: fresh.account.balancePoints },
        },
        note: "OTP codes are written to tmp/loyalty-otp-outbox.log when LOYALTY_OTP_DEV_OUTBOX=1.",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

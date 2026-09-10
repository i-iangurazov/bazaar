/** Complete dynamic route fixtures through normal services, only in the local UI database. */
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { uxEnvironment, assertUxDatabase } from "./environment";
Object.assign(process.env, uxEnvironment());
assertUxDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { businessCaller } = await import("../../src/server/services/baamBusiness");
const { getLogger } = await import("../../src/server/logging");
const fixturePath = "artifacts/ux/fixture.json";
const f = JSON.parse(await readFile(fixturePath, "utf8"));
try {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: f.adminId } });
  assert.equal(user.organizationId, f.organizationId);
  assert.equal(user.email, "admin@test.local");
  const api = businessCaller({
    prisma,
    user: { ...user, organizationId: f.organizationId, isOrgOwner: true, isPlatformOwner: false },
    impersonator: null,
    impersonationSessionId: null,
    ip: "127.0.0.1",
    requestId: randomUUID(),
    logger: getLogger("ux-details"),
  });
  const notes = "Isolated UI detail fixture";
  const count =
    (await prisma.stockCount.findFirst({ where: { organizationId: f.organizationId, notes } })) ??
    (await api.counts.create({ storeId: f.otherStoreId, notes }));
  const order = await api.orders.createDraft({
    storeId: f.otherStoreId,
    customerName: "Учебный покупатель",
    notes,
    lines: [{ productId: f.products[6].id, qty: 1 }],
    idempotencyKey: `ux-details-order-${f.organizationId}`,
  });
  const writeOff = await api.inventory.postStockWriteOff({
    storeId: f.otherStoreId,
    reason: "Другое",
    comment: notes,
    lines: [{ productId: f.products[7].id, qty: 1 }],
    idempotencyKey: `ux-details-write-off-${f.organizationId}`,
  });
  const receiving = await prisma.stockMovement.findFirstOrThrow({
    where: { storeId: f.otherStoreId, referenceType: "STOCK_RECEIVING" },
    orderBy: { createdAt: "asc" },
  });
  const transfer = await prisma.stockMovement.findFirstOrThrow({
    where: { storeId: f.otherStoreId, referenceType: "TRANSFER" },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(receiving.referenceId && transfer.referenceId);
  const receivingKey = `STOCK_RECEIVING:STOCK_RECEIVING:${receiving.referenceId}`;
  f.detailRoutes = {
    "/stores/[id]/hardware": `/stores/${f.storeId}/hardware`,
    "/stores/[id]/compliance": `/stores/${f.storeId}/compliance`,
    "/sales/orders/[id]": `/sales/orders/${order.id}`,
    "/purchase-orders/[id]": `/purchase-orders/${f.purchase.id}`,
    "/products/[id]": `/products/${f.longProductId}`,
    "/inventory/write-offs/[id]/edit": `/inventory/write-offs/${writeOff.writeOffId}/edit`,
    "/inventory/transfers/[id]/edit": `/inventory/transfers/${transfer.referenceId}/edit`,
    "/inventory/receiving/[id]/edit": `/inventory/receiving/${receiving.referenceId}/edit`,
    "/inventory/movements/[id]": `/inventory/movements/${encodeURIComponent(receivingKey)}`,
    "/inventory/counts/[id]": `/inventory/counts/${count.id}`,
  };
  await writeFile(fixturePath, JSON.stringify(f, null, 2));
  console.log("Ten dynamic page templates now have isolated document fixtures");
} finally {
  await prisma.$disconnect();
}

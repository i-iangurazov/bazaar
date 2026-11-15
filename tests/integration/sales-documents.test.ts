import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { getSalesDocument } from "@/server/services/salesDocuments";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
async function fixture(isPosSale = false) {
  const f = await seedBase({ plan: "BUSINESS" });
  const variant = await prisma.productVariant.create({ data: { productId: f.product.id, name: "Размер 125 мм", attributes: {} } });
  await prisma.unit.update({ where: { id: f.baseUnit.id }, data: { labelRu: "кг", labelKg: "кг", quantityPrecision: 3 } });
  const order = await prisma.customerOrder.create({ data: {
    organizationId: f.org.id, storeId: f.store.id, number: "PRINT-001", isPosSale,
    status: "COMPLETED", completedAt: new Date("2026-11-15T20:30:00Z"),
    currencyCode: "USD", currencyRateKgsPerUnit: 90,
    customerName: "Имя в продаже", customerPhone: "+996555000101", customerEmail: "sale@example.test", customerAddress: "Адрес в продаже",
    subtotalKgs: 228.13, discountKgs: 0, totalKgs: 228.13,
    lines: { create: { productId: f.product.id, variantId: variant.id, variantKey: variant.id,
      qty: 0.25, unitPriceKgs: 912.5, lineTotalKgs: 228.13, unitCostKgs: 7, lineCostTotalKgs: 1.75 } },
  } });
  await prisma.store.update({ where: { id: f.store.id }, data: { currencyCode: "EUR", currencyRateKgsPerUnit: 100, legalName: "ИП Продавец", inn: "12345678901234" } });
  const request = { actorId: f.adminUser.id, organizationId: f.org.id, customerOrderId: order.id, locale: "ru" };
  return { ...f, order, variant, request };
}

describeDb("sales document authorization and sale-price projection", () => {
  beforeEach(resetDatabase);

  it.each([false, true])("projects ordinary/POS=%s sale prices, variants and immutable currency/contact snapshots without costs or writes", async (isPosSale) => {
    const f = await fixture(isPosSale);
    const before = await prisma.customerOrder.findUniqueOrThrow({ where: { id: f.order.id }, include: { lines: true } });
    const result = await getSalesDocument(f.request);
    expect(result).toMatchObject({ id: f.order.id, status: "COMPLETED", isPosSale, currencyCode: "USD", currencyRateKgsPerUnit: 90,
      customer: { name: "Имя в продаже", phone: "+996555000101", email: "sale@example.test", address: "Адрес в продаже" },
      seller: { name: "ИП Продавец", inn: "12345678901234" }, totalKgs: 228.13 });
    expect(result.items[0]).toMatchObject({ name: f.product.name, variantName: "Размер 125 мм", sku: f.product.sku, qty: 0.25, unit: "кг", unitPriceKgs: 912.5, lineTotalKgs: 228.13 });
    expect(JSON.stringify(result)).not.toMatch(/unitCost|lineCost|stockMovement|passwordHash|payments/);
    expect(await prisma.customerOrder.findUniqueOrThrow({ where: { id: f.order.id }, include: { lines: true } })).toEqual(before);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.salePayment.count()).toBe(0);
    expect(await prisma.registerShift.count()).toBe(0);
  });

  it("does not replace missing historical contacts with a later CRM profile", async () => {
    const f = await fixture();
    const customer = await prisma.customer.create({ data: { organizationId: f.org.id, storeId: f.store.id, name: "Current CRM name", phone: "+996555000102" } });
    await prisma.customerOrder.update({ where: { id: f.order.id }, data: { customerId: customer.id, customerName: null, customerEmail: null, customerPhone: null, customerAddress: null, status: "DRAFT", completedAt: null } });
    const result = await getSalesDocument(f.request);
    expect(result.status).toBe("DRAFT");
    expect(result.customer).toEqual({ name: null, phone: null, email: null, address: null });
  });

  it("enforces current active membership, role and store assignments instead of stale session privileges", async () => {
    const f = await fixture();
    await expect(getSalesDocument({ ...f.request, actorId: f.staffUser.id })).resolves.toMatchObject({ id: f.order.id });
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.staffUser.id } });
    await expect(getSalesDocument({ ...f.request, actorId: f.staffUser.id })).rejects.toMatchObject({ message: "storeAccessDenied", status: 403 });
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { role: "STAFF", isOrgOwner: false } });
    await expect(getSalesDocument(f.request)).rejects.toMatchObject({ message: "storeAccessDenied", status: 403 });
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { isActive: false } });
    await expect(getSalesDocument(f.request)).rejects.toMatchObject({ message: "unauthorized", status: 401 });
  });

  it("does not reveal a foreign organization's document or accept a foreign actor", async () => {
    const f = await fixture();
    const other = await prisma.organization.create({ data: { name: "Other tenant", plan: "BUSINESS" } });
    const foreignStore = await prisma.store.create({ data: { organizationId: other.id, name: "Foreign store", code: "FOREIGN" } });
    const foreign = await prisma.customerOrder.create({ data: { organizationId: other.id, storeId: foreignStore.id, number: "SECRET" } });
    await expect(getSalesDocument({ ...f.request, customerOrderId: foreign.id })).rejects.toMatchObject({ status: 404 });
    await expect(getSalesDocument({ ...f.request, organizationId: other.id })).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    { customerOrders: false, pos: true },
    { customerOrders: true, pos: false },
  ])("respects separately agreed customer-order/POS entitlements: %j", async ({ customerOrders, pos }) => {
    const f = await fixture();
    const terms = createContractTerms("2026-10");
    terms.plans.BUSINESS.features.customerOrders = customerOrders;
    terms.plans.BUSINESS.features.pos = pos;
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-10", termsSnapshot: terms } });
    if (customerOrders) await expect(getSalesDocument(f.request)).resolves.toMatchObject({ isPosSale: false });
    else await expect(getSalesDocument(f.request)).rejects.toMatchObject({ message: "featureLockedCustomerOrders", status: 403 });
    await prisma.customerOrder.update({ where: { id: f.order.id }, data: { isPosSale: true } });
    if (pos) await expect(getSalesDocument(f.request)).resolves.toMatchObject({ isPosSale: true });
    else await expect(getSalesDocument(f.request)).rejects.toMatchObject({ message: "featureLockedPos", status: 403 });
  });

  it("rejects an inactive subscription and keeps canceled documents accurately marked", async () => {
    const f = await fixture();
    await prisma.customerOrder.update({ where: { id: f.order.id }, data: { status: "CANCELED" } });
    expect((await getSalesDocument(f.request)).status).toBe("CANCELED");
    await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionStatus: "CANCELED" } });
    await expect(getSalesDocument(f.request)).rejects.toMatchObject({ message: "subscriptionInactive", status: 403 });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { adjustStock } from "@/server/services/inventory";
import { updateCustomerOrderLine } from "@/server/services/salesOrders";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const asUser = (user: { id: string; email: string; role: Role; organizationId: string | null; isOrgOwner?: boolean | null }) => ({
  ...user,
  organizationId: user.organizationId!,
  isOrgOwner: Boolean(user.isOrgOwner),
});

async function fixture() {
  const f = await seedBase({ plan: "BUSINESS" });
  await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 120 } });
  await prisma.storePrice.create({ data: {
    organizationId: f.org.id, storeId: f.store.id, productId: f.product.id,
    variantKey: "BASE", priceKgs: 100, discountType: "PERCENTAGE", discountPercentage: 20,
  } });
  const customer = await prisma.customer.create({ data: {
    organizationId: f.org.id, storeId: f.store.id, name: "Existing name-only customer",
  } });
  return { ...f, customer, api: createTestCaller(asUser(f.adminUser)) };
}

describeDb("ordinary sales orders: customer identity and negotiated prices", () => {
  beforeEach(resetDatabase);

  it("previews the same effective base/variant price as order creation and preserves store access", async () => {
    const f = await fixture();
    const staff = createTestCaller(asUser(f.staffUser));
    expect(await staff.salesOrders.linePrice({ storeId: f.store.id, productId: f.product.id })).toEqual({ unitPriceKgs: 80, hasConfiguredPrice: true });
    const variant = await prisma.productVariant.create({ data: { productId: f.product.id, name: "Priced variant", attributes: {} } });
    await prisma.storePrice.create({ data: {
      organizationId: f.org.id, storeId: f.store.id, productId: f.product.id,
      variantId: variant.id, variantKey: variant.id, priceKgs: 250,
      discountType: "PERCENTAGE", discountPercentage: 10,
    } });
    const preview = await staff.salesOrders.linePrice({ storeId: f.store.id, productId: f.product.id, variantId: variant.id });
    expect(preview).toEqual({ unitPriceKgs: 225, hasConfiguredPrice: true });
    const order = await staff.salesOrders.createDraft({ storeId: f.store.id, idempotencyKey: "customer-price-preview", lines: [{ productId: f.product.id, variantId: variant.id, qty: 1 }] });
    const saved = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: order.id } });
    expect(Number(saved.unitPriceKgs)).toBe(preview.unitPriceKgs);
    const hiddenStore = await prisma.store.create({ data: { organizationId: f.org.id, name: "Hidden preview store", code: "HIDDEN-PREVIEW" } });
    await expect(staff.salesOrders.linePrice({ storeId: hiddenStore.id, productId: f.product.id })).rejects.toMatchObject({ message: "storeAccessDenied" });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });
    await expect(staff.salesOrders.linePrice({ storeId: f.store.id, productId: f.product.id, variantId: variant.id })).rejects.toMatchObject({ message: "variantNotFound" });
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.staffUser.id, storeId: f.store.id } });
    await expect(staff.salesOrders.linePrice({ storeId: f.store.id, productId: f.product.id })).rejects.toMatchObject({ message: "storeAccessDenied" });
  });

  it("completes a negotiated customer sale without a POS shift and keeps stock/payment rules separate", async () => {
    const f = await fixture();
    await adjustStock({
      organizationId: f.org.id, actorId: f.adminUser.id, storeId: f.store.id,
      productId: f.product.id, qtyDelta: 10, reason: "sale fixture",
      idempotencyKey: "customer-price-stock", requestId: "customer-price-stock",
    });
    const request = {
      storeId: f.store.id, idempotencyKey: "customer-price-create",
      customerId: f.customer.id, customerName: "Name on this order",
      lines: [{ productId: f.product.id, qty: 2, unitPriceKgs: 68.25 }],
    };
    const order = await f.api.salesOrders.createDraft(request);
    expect((await f.api.salesOrders.createDraft(request)).id).toBe(order.id);
    const line = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: order.id } });
    expect(line.manualPrice).toBe(true);
    expect(line.priceSource).toBe("MANUAL");
    expect(Number(line.baseUnitPriceKgs)).toBe(68.25);
    expect(line.appliedDiscountType).toBeNull();
    expect(Number(line.lineTotalKgs)).toBe(136.5);
    await f.api.salesOrders.updateLine({ lineId: line.id, qty: 3 });
    await f.api.salesOrders.confirm({ customerOrderId: order.id });
    await f.api.salesOrders.markReady({ customerOrderId: order.id });
    await f.api.salesOrders.complete({ customerOrderId: order.id, idempotencyKey: "customer-price-complete" });
    await f.api.salesOrders.complete({ customerOrderId: order.id, idempotencyKey: "customer-price-complete-again" });
    const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    expect(saved.customerId).toBe(f.customer.id);
    expect(saved.customerName).toBe("Name on this order");
    expect(saved.isPosSale).toBe(false);
    expect(saved.status).toBe("COMPLETED");
    expect(Number(saved.totalKgs)).toBe(204.75);
    expect(Number(saved.lines[0]!.unitPriceKgs)).toBe(68.25);
    expect(await prisma.registerShift.count()).toBe(0);
    expect(await prisma.salePayment.count({ where: { customerOrderId: order.id } })).toBe(0);
    const movements = await prisma.stockMovement.findMany({ where: { referenceType: "CustomerOrder", referenceId: order.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "SALE", qtyDelta: -3 });
    expect((await prisma.inventorySnapshot.findFirstOrThrow({ where: { storeId: f.store.id, productId: f.product.id } })).onHand).toBe(7);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).basePriceKgs)).toBe(120);
    expect(Number((await prisma.storePrice.findFirstOrThrow({ where: { storeId: f.store.id, productId: f.product.id } })).priceKgs)).toBe(100);
    const profile = await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } });
    expect(profile.name).toBe(f.customer.name);
    expect(profile.orderCount).toBe(1);
    expect(await prisma.customer.count({ where: { organizationId: f.org.id } })).toBe(1);
    const detail = await f.api.customers.detail({ customerId: f.customer.id });
    expect(detail.completedOrderCount).toBe(1);
    expect(detail.lastCompletedOrderAt).toEqual(saved.completedAt);
    expect(detail.recentOrders[0]).toMatchObject({ id: order.id, isPosSale: false, source: "MANUAL", totalKgs: 204.75 });
    expect(detail.recentOrders[0]!.store.name).toBe(f.store.name);
    const payment = await f.api.salesOrders.paymentInfo({ customerOrderId: order.id });
    expect(payment).toMatchObject({ paidKgs: 0, hasEvidence: false, remainingKgs: 204.75, shifts: [] });
    await expect(f.api.salesOrders.recordPayment({
      customerOrderId: order.id, shiftId: "no-open-shift", amountKgs: 204.75,
      method: "TRANSFER", idempotencyKey: "customer-price-not-a-payment",
    })).rejects.toMatchObject({ message: "posShiftNotOpen" });
    await expect(f.api.salesOrders.updateLine({ lineId: line.id, unitPriceKgs: 1 })).rejects.toMatchObject({ message: "salesOrderNotEditable" });
  });

  it("keeps default discounts, supports zero/manual prices, fractional quantities and price-only edits", async () => {
    const f = await fixture();
    await prisma.unit.update({ where: { id: f.baseUnit.id }, data: { quantityPrecision: 3 } });
    const order = await f.api.salesOrders.createDraft({
      storeId: f.store.id, idempotencyKey: "customer-price-default", lines: [{ productId: f.product.id, qty: 0.125 }],
    });
    const line = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: order.id } });
    expect(Number(line.unitPriceKgs)).toBe(80);
    expect(line.appliedDiscountType).toBe("PERCENTAGE");
    await f.api.salesOrders.updateLine({ lineId: line.id, unitPriceKgs: 0 });
    const zero = await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(zero.qty).toBe(0.125);
    expect(Number(zero.unitPriceKgs)).toBe(0);
    expect(zero.appliedDiscountType).toBeNull();
    expect(zero.appliedDiscountPercentage).toBeNull();
    expect(zero.appliedDiscountAmountKgs).toBeNull();
    await f.api.salesOrders.updateLine({ lineId: line.id, unitPriceKgs: 99.95 });
    await f.api.salesOrders.updateLine({ lineId: line.id, qty: 0.25 });
    const edited = await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(edited.unitPriceKgs)).toBe(99.95);
    expect(Number(edited.lineTotalKgs)).toBe(24.99);
    const second = await f.api.salesOrders.createDraft({ storeId: f.store.id, idempotencyKey: "customer-price-add" });
    const added = await f.api.salesOrders.addLine({ customerOrderId: second.id, productId: f.product.id, qty: 2, unitPriceKgs: 37.5 });
    expect(added.unitPriceKgs).toBe(37.5);
    expect(added.lineTotalKgs).toBe(75);
    expect(added.priceSource).toBe("MANUAL");
    for (const price of [-1, Number.POSITIVE_INFINITY, Number.NaN, 10_000_000_000]) {
      await expect(f.api.salesOrders.updateLine({ lineId: line.id, unitPriceKgs: price })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(f.api.salesOrders.updateLine({ lineId: line.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(f.api.salesOrders.updateLine({ lineId: line.id, qty: 2, unitPriceKgs: 9_999_999_999.99 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(Number((await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } })).unitPriceKgs)).toBe(99.95);
  });

  it("binds idempotency to the chosen customer and manual price while keeping retries side-effect free", async () => {
    const f = await fixture();
    const request = { storeId: f.store.id, customerId: f.customer.id, idempotencyKey: "customer-price-fingerprint", lines: [{ productId: f.product.id, qty: 1, unitPriceKgs: 45 }] };
    const order = await f.api.salesOrders.createDraft(request);
    await expect(f.api.salesOrders.createDraft({ ...request, lines: [{ ...request.lines[0]!, unitPriceKgs: 46 }] })).rejects.toMatchObject({ message: "operationRequestPayloadMismatch" });
    await expect(f.api.salesOrders.createDraft({ ...request, customerId: null })).rejects.toMatchObject({ message: "operationRequestPayloadMismatch" });
    for (const field of ["customerName", "customerEmail", "customerPhone", "customerAddress"] as const) {
      await expect(f.api.salesOrders.createDraft({ ...request, [field]: null })).rejects.toMatchObject({ message: "operationRequestPayloadMismatch" });
    }
    expect((await f.api.salesOrders.createDraft(request)).id).toBe(order.id);
    expect(await prisma.customerOrder.count()).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).orderCount).toBe(1);
    const legacyInput = { storeId: f.store.id, idempotencyKey: "customer-price-legacy-fingerprint" };
    const legacy = await f.api.salesOrders.createDraft(legacyInput);
    expect((await f.api.salesOrders.createDraft({ ...legacyInput, customerName: null, customerEmail: null, customerPhone: null, customerAddress: null })).id).toBe(legacy.id);
  });

  it("rejects an overflowing order subtotal atomically even when each line fits the money columns", async () => {
    const f = await fixture();
    const second = await prisma.product.create({ data: {
      organizationId: f.org.id, supplierId: f.supplier.id, sku: "PRICE-OVERFLOW-2", name: "Second product",
      unit: f.baseUnit.code, baseUnitId: f.baseUnit.id,
    } });
    await prisma.storeProduct.create({ data: { organizationId: f.org.id, storeId: f.store.id, productId: second.id, isActive: true } });
    await expect(f.api.salesOrders.createDraft({
      storeId: f.store.id, customerId: f.customer.id, idempotencyKey: "customer-price-subtotal-overflow",
      lines: [{ productId: f.product.id, qty: 1, unitPriceKgs: 6_000_000_000 }, { productId: second.id, qty: 1, unitPriceKgs: 6_000_000_000 }],
    })).rejects.toMatchObject({ message: "invalidInput", code: "BAD_REQUEST" });
    expect(await prisma.customerOrder.count()).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).orderCount).toBe(0);
    const order = await f.api.salesOrders.createDraft({ storeId: f.store.id, idempotencyKey: "customer-price-subtotal-valid", lines: [{ productId: f.product.id, qty: 1, unitPriceKgs: 6_000_000_000 }] });
    await expect(f.api.salesOrders.addLine({ customerOrderId: order.id, productId: second.id, qty: 1, unitPriceKgs: 6_000_000_000 })).rejects.toMatchObject({ message: "invalidInput" });
    expect(await prisma.customerOrderLine.count({ where: { customerOrderId: order.id } })).toBe(1);
    const added = await f.api.salesOrders.addLine({ customerOrderId: order.id, productId: second.id, qty: 1, unitPriceKgs: 3_000_000_000 });
    await expect(f.api.salesOrders.updateLine({ lineId: added.id, unitPriceKgs: 5_000_000_000 })).rejects.toMatchObject({ message: "invalidInput" });
    expect(Number((await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } })).totalKgs)).toBe(9_000_000_000);
    expect(Number((await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: added.id } })).unitPriceKgs)).toBe(3_000_000_000);
  });

  it("keeps negotiated KGS amounts and the order's currency snapshot after store currency changes", async () => {
    const f = await fixture();
    await prisma.store.update({ where: { id: f.store.id }, data: { currencyCode: "USD", currencyRateKgsPerUnit: 90 } });
    const order = await f.api.salesOrders.createDraft({ storeId: f.store.id, idempotencyKey: "customer-price-usd", lines: [{ productId: f.product.id, qty: 2, unitPriceKgs: 912.5 }] });
    const line = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: order.id } });
    await prisma.store.update({ where: { id: f.store.id }, data: { currencyCode: "EUR", currencyRateKgsPerUnit: 100 } });
    await f.api.salesOrders.updateLine({ lineId: line.id, qty: 3 });
    const saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    expect(saved.currencyCode).toBe("USD");
    expect(Number(saved.currencyRateKgsPerUnit)).toBe(90);
    expect(Number(saved.lines[0]!.unitPriceKgs)).toBe(912.5);
    expect(Number(saved.totalKgs)).toBe(2737.5);
    expect(Number((await prisma.storePrice.findFirstOrThrow({ where: { productId: f.product.id, storeId: f.store.id } })).priceKgs)).toBe(100);
  });

  it("releases an applied loyalty discount before replacing the negotiated price", async () => {
    const f = await fixture();
    const order = await f.api.salesOrders.createDraft({ storeId: f.store.id, idempotencyKey: "customer-price-loyalty", lines: [{ productId: f.product.id, qty: 2, unitPriceKgs: 100 }] });
    const line = await prisma.customerOrderLine.findFirstOrThrow({ where: { customerOrderId: order.id } });
    const program = await prisma.loyaltyProgram.create({ data: { organizationId: f.org.id, enabled: true } });
    const member = await prisma.loyaltyMember.create({ data: { organizationId: f.org.id, programId: program.id, contactKey: "email:loyalty@example.test" } });
    const account = await prisma.loyaltyAccount.create({ data: { organizationId: f.org.id, programId: program.id, memberId: member.id } });
    await prisma.loyaltyOrderApplication.create({ data: {
      organizationId: f.org.id, customerOrderId: order.id, programId: program.id,
      memberId: member.id, accountId: account.id, status: "APPLIED",
      memberDiscountKgs: 20, rulesSnapshot: { version: 2 },
      lineDistribution: [{ lineId: line.id, productId: f.product.id, variantKey: "BASE", qty: 2,
        originalUnitPriceKgs: "100", originalLineTotalKgs: "200", baseUnitPriceKgs: "100",
        appliedUnitPriceKgs: "90", appliedLineTotalKgs: "180", redeemValueKgs: "0", earnWeightKgs: "180" }],
    } });
    await prisma.customerOrderLine.update({ where: { id: line.id }, data: { unitPriceKgs: 90, lineTotalKgs: 180 } });
    await prisma.customerOrder.update({ where: { id: order.id }, data: { subtotalKgs: 180, totalKgs: 180 } });
    await f.api.salesOrders.updateLine({ lineId: line.id, unitPriceKgs: 75.25 });
    const updated = await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(updated.unitPriceKgs)).toBe(75.25);
    expect(Number(updated.baseUnitPriceKgs)).toBe(75.25);
    expect(Number(updated.lineTotalKgs)).toBe(150.5);
    expect((await prisma.loyaltyOrderApplication.findUniqueOrThrow({ where: { customerOrderId: order.id } })).status).toBe("RELEASED");
    expect(await prisma.loyaltyLedgerEntry.count()).toBe(0);
  });

  it("retains the existing price-editing role access and validates variant ownership", async () => {
    const f = await fixture();
    const variant = await prisma.productVariant.create({ data: { productId: f.product.id, name: "Blue", attributes: {} } });
    for (const user of [f.adminUser, f.managerUser, f.staffUser, f.cashierUser]) {
      const api = createTestCaller(asUser(user));
      const order = await api.salesOrders.createDraft({ storeId: f.store.id, idempotencyKey: `customer-role-${user.id}` });
      const line = await api.salesOrders.addLine({ customerOrderId: order.id, productId: f.product.id, variantId: variant.id, qty: 1, unitPriceKgs: 42 });
      const changed = await api.salesOrders.updateLine({ lineId: line.id, unitPriceKgs: 43 });
      expect(changed.unitPriceKgs).toBe(43);
      expect(changed.variantId).toBe(variant.id);
    }
    await prisma.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });
    await expect(f.api.salesOrders.createDraft({ storeId: f.store.id, idempotencyKey: "customer-inactive-variant", lines: [{ productId: f.product.id, variantId: variant.id, qty: 1, unitPriceKgs: 12 }] })).rejects.toMatchObject({ message: "variantNotFound" });
  });

  it("selects clients from accessible stores and rejects hidden, deleted, foreign and revoked access", async () => {
    const f = await fixture();
    const otherStore = await prisma.store.create({ data: { organizationId: f.org.id, name: "Other Store", code: "OTHER" } });
    const other = await prisma.customer.create({ data: { organizationId: f.org.id, storeId: otherStore.id, name: "Other client" } });
    const foreignOrg = await prisma.organization.create({ data: { name: "Foreign", plan: "BUSINESS" } });
    const foreignStore = await prisma.store.create({ data: { organizationId: foreignOrg.id, name: "Foreign", code: "FOREIGN" } });
    const foreign = await prisma.customer.create({ data: { organizationId: foreignOrg.id, storeId: foreignStore.id, name: "Foreign client" } });
    const deleted = await prisma.customer.create({ data: { organizationId: f.org.id, storeId: f.store.id, name: "Deleted", deletedAt: new Date() } });
    const staff = createTestCaller(asUser(f.staffUser));
    expect((await staff.salesOrders.customerOptions({ storeId: f.store.id })).map((c) => c.id)).toEqual([f.customer.id]);
    expect((await f.api.salesOrders.customerOptions({ storeId: f.store.id, search: "Other" })).map((c) => c.id)).toEqual([other.id]);
    for (const id of [other.id, foreign.id, deleted.id]) {
      await expect(staff.salesOrders.createDraft({ storeId: f.store.id, customerId: id, idempotencyKey: `customer-scope-${id}` })).rejects.toMatchObject({ message: "customerNotFound" });
    }
    await expect(staff.salesOrders.customerOptions({ storeId: otherStore.id })).rejects.toMatchObject({ message: "storeAccessDenied" });
    await prisma.userStoreAccess.create({ data: { organizationId: f.org.id, userId: f.staffUser.id, storeId: otherStore.id } });
    const selected = await staff.salesOrders.createDraft({ storeId: f.store.id, customerId: other.id, idempotencyKey: "customer-scope-granted" });
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: selected.id } })).customerId).toBe(other.id);
    for (const id of [foreign.id, deleted.id]) {
      await expect(staff.salesOrders.setCustomer({ customerOrderId: selected.id, customerId: id })).rejects.toMatchObject({ message: "customerNotFound" });
    }
    const line = await staff.salesOrders.addLine({ customerOrderId: selected.id, productId: f.product.id, qty: 1, unitPriceKgs: 42 });
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.staffUser.id } });
    await expect(staff.salesOrders.customerOptions({ storeId: f.store.id })).rejects.toMatchObject({ message: "storeAccessDenied" });
    await expect(updateCustomerOrderLine({ organizationId: f.org.id, actorId: f.staffUser.id, lineId: line.id, unitPriceKgs: 99, requestId: "revoked-direct-service" })).rejects.toMatchObject({ message: "storeAccessDenied" });
    expect(Number((await prisma.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } })).unitPriceKgs)).toBe(42);
  });

  it("keeps contact snapshots independent of selected profiles and preserves explicit clear versus legacy matching", async () => {
    const f = await fixture();
    await prisma.customer.update({ where: { id: f.customer.id }, data: { phone: "0555123456", address: "---" } });
    const order = await f.api.salesOrders.createDraft({ storeId: f.store.id, customerId: f.customer.id, idempotencyKey: "customer-snapshot-legacy" });
    let saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved).toMatchObject({ customerId: f.customer.id, customerPhone: "0555123456", customerAddress: "---" });
    await f.api.salesOrders.setCustomer({ customerOrderId: order.id, customerId: f.customer.id, customerName: "Order delivery name", customerPhone: "+996555111222", customerAddress: "Bishkek, Chui 1" });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).toMatchObject({ name: f.customer.name, phone: "0555123456", address: "---" });
    await f.api.salesOrders.setCustomer({ customerOrderId: order.id, customerId: null, customerName: "Unlinked", customerEmail: "unlinked@example.test" });
    saved = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.customerId).toBeNull();
    expect(await prisma.customer.count({ where: { organizationId: f.org.id } })).toBe(1);
    const legacy = await f.api.salesOrders.createDraft({ storeId: f.store.id, customerName: "Legacy contact", customerEmail: "legacy@example.test", idempotencyKey: "customer-legacy-upsert" });
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: legacy.id } })).customerId).not.toBeNull();
    const sameName = await f.api.salesOrders.createDraft({ storeId: f.store.id, customerName: f.customer.name, idempotencyKey: "customer-no-name-match" });
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: sameName.id } })).customerId).toBeNull();
    await expect(f.api.salesOrders.createDraft({ storeId: f.store.id, customerPhone: "0555123456", idempotencyKey: "customer-invalid-new-phone" })).rejects.toMatchObject({ message: "customerPhoneInvalid" });
  });

  it("preserves an unchanged legacy order contact independently from its linked customer's current profile", async () => {
    const f = await fixture();
    const order = await f.api.salesOrders.createDraft({
      storeId: f.store.id, customerId: f.customer.id, idempotencyKey: "customer-legacy-order-snapshot",
    });
    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { customerPhone: "555-order-legacy", customerAddress: "?" },
    });
    await prisma.customer.update({
      where: { id: f.customer.id },
      data: { phone: "555-profile-legacy", address: "!" },
    });
    const savedProfile = await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } });
    await expect(f.api.salesOrders.setCustomer({
      customerOrderId: order.id, customerId: f.customer.id, customerName: "Order name edited",
      customerPhone: "555-order-legacy", customerAddress: "?",
    })).resolves.toMatchObject({
      customerId: f.customer.id, customerPhone: "555-order-legacy", customerAddress: "?",
    });
    await expect(f.api.salesOrders.setCustomer({
      customerOrderId: order.id, customerId: f.customer.id,
    })).resolves.toMatchObject({ customerPhone: "555-order-legacy", customerAddress: "?" });
    await expect(f.api.salesOrders.setCustomer({
      customerOrderId: order.id, customerId: f.customer.id,
      customerPhone: savedProfile.phone, customerAddress: savedProfile.address,
    })).resolves.toMatchObject({ customerPhone: savedProfile.phone, customerAddress: savedProfile.address });
    await expect(f.api.salesOrders.setCustomer({
      customerOrderId: order.id, customerId: f.customer.id,
      customerPhone: "555-untrusted-value", customerAddress: savedProfile.address,
    })).rejects.toMatchObject({ message: "customerPhoneInvalid" });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).toEqual(savedProfile);
    const another = await prisma.customer.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "Another selected customer" },
    });
    await expect(f.api.salesOrders.setCustomer({
      customerOrderId: order.id, customerId: another.id,
      customerPhone: "555-order-legacy", customerAddress: "?",
    })).rejects.toMatchObject({ message: "customerPhoneInvalid" });
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } })).customerId).toBe(f.customer.id);
  });

  it("scopes mixed POS/order purchase history and its aggregate without counting drafts or canceled orders", async () => {
    const f = await fixture();
    const hiddenStore = await prisma.store.create({ data: { organizationId: f.org.id, name: "Restricted", code: "RESTRICTED" } });
    const now = new Date();
    await prisma.customerOrder.createMany({ data: [
      { number: "SO-HISTORY", storeId: f.store.id, isPosSale: false, status: "COMPLETED" as const },
      { number: "POS-HISTORY", storeId: f.store.id, isPosSale: true, status: "COMPLETED" as const },
      { number: "SO-HIDDEN", storeId: hiddenStore.id, isPosSale: false, status: "COMPLETED" as const },
      { number: "SO-DRAFT", storeId: f.store.id, isPosSale: false, status: "DRAFT" as const },
      { number: "SO-CANCELED", storeId: f.store.id, isPosSale: false, status: "CANCELED" as const },
    ].map((order) => ({ ...order, organizationId: f.org.id, customerId: f.customer.id, createdById: f.adminUser.id, updatedById: f.adminUser.id, completedAt: order.status === "COMPLETED" ? now : null, totalKgs: 100, subtotalKgs: 100 })) });
    const manager = createTestCaller(asUser(f.managerUser));
    const scoped = await manager.customers.detail({ customerId: f.customer.id });
    expect(scoped.completedOrderCount).toBe(2);
    expect(scoped.recentOrders.map((o) => o.number).sort()).toEqual(["POS-HISTORY", "SO-HISTORY"]);
    expect(scoped.lastCompletedOrderAt).toEqual(now);
    expect((await f.api.customers.detail({ customerId: f.customer.id })).completedOrderCount).toBe(3);
  });
});

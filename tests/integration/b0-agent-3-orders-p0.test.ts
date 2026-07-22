import {
  CustomerOrderSource,
  CustomerOrderStatus,
  PurchaseOrderStatus,
  StockMovementType,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  createBazaarApiOrder,
  getBazaarApiOrder,
  listBazaarApiOrders,
} from "@/server/services/bazaarApi";
import { adjustStock } from "@/server/services/inventory";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
} from "@/server/services/purchaseOrders";
import {
  addCustomerOrderLine,
  completeCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrderDraft,
  markCustomerOrderReady,
} from "@/server/services/salesOrders";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const evidence = (issueId: string, payload: Record<string, unknown>) => {
  console.info(`[B0-EVIDENCE] ${issueId} ${JSON.stringify(payload)}`);
};

const snapshotFor = (storeId: string, productId: string) =>
  prisma.inventorySnapshot.findUnique({
    where: {
      storeId_productId_variantKey: {
        storeId,
        productId,
        variantKey: "BASE",
      },
    },
  });

const seedStock = async (input: {
  organizationId: string;
  storeId: string;
  productId: string;
  actorId: string;
  qty: number;
  key: string;
}) =>
  adjustStock({
    organizationId: input.organizationId,
    storeId: input.storeId,
    productId: input.productId,
    qtyDelta: input.qty,
    reason: input.key,
    actorId: input.actorId,
    requestId: input.key,
    idempotencyKey: input.key,
  });

describeDb("B0 Agent 3 order P0 runtime verification", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reproduces HARD-A3-001: completing an API order deducts stock twice", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    await seedStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      actorId: adminUser.id,
      qty: 10,
      key: "b0-a3-001-seed",
    });

    const before = await snapshotFor(store.id, product.id);
    const order = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "B0-A3-001",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const afterCreate = await snapshotFor(store.id, product.id);

    await markCustomerOrderReady({
      customerOrderId: order.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "b0-a3-001-ready",
    });
    await completeCustomerOrder({
      customerOrderId: order.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "b0-a3-001-complete",
      idempotencyKey: "b0-a3-001-complete-key",
    });

    const afterComplete = await snapshotFor(store.id, product.id);
    const saleMovements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        referenceType: "CustomerOrder",
        referenceId: order.id,
        type: StockMovementType.SALE,
      },
      orderBy: { createdAt: "asc" },
    });

    evidence("HARD-A3-001", {
      orderId: order.id,
      stockBefore: before?.onHand,
      stockAfterApiCreate: afterCreate?.onHand,
      stockAfterComplete: afterComplete?.onHand,
      saleMovementDeltas: saleMovements.map((movement) => movement.qtyDelta),
    });

    expect(before?.onHand).toBe(10);
    expect(afterCreate?.onHand).toBe(9);
    expect(afterComplete?.onHand).toBe(8);
    expect(saleMovements.map((movement) => movement.qtyDelta)).toEqual([-1, -1]);
  });

  it("reproduces HARD-A3-003: missing API operation identity duplicates orders and stock effects", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 75 } });
    await seedStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      actorId: adminUser.id,
      qty: 10,
      key: "b0-a3-003-seed",
    });
    const input = {
      organizationId: org.id,
      storeId: store.id,
      lines: [{ productId: product.id, qty: 1 }],
    };

    const sequential = [await createBazaarApiOrder(input), await createBazaarApiOrder(input)];
    const concurrent = await Promise.all([
      createBazaarApiOrder(input),
      createBazaarApiOrder(input),
    ]);
    const orders = await prisma.customerOrder.findMany({
      where: { organizationId: org.id, storeId: store.id, source: CustomerOrderSource.API },
      orderBy: { number: "asc" },
    });
    const snapshot = await snapshotFor(store.id, product.id);

    evidence("HARD-A3-003", {
      sequentialIds: sequential.map((order) => order.id),
      concurrentIds: concurrent.map((order) => order.id),
      persistedOrderIds: orders.map((order) => order.id),
      stockAfterFourEquivalentRequests: snapshot?.onHand,
    });

    expect(new Set([...sequential, ...concurrent].map((order) => order.id)).size).toBe(4);
    expect(orders).toHaveLength(4);
    expect(snapshot?.onHand).toBe(6);
  });

  it("reproduces HARD-A3-004: ordinary sales draft creation is not idempotent", async () => {
    const { org, store, adminUser } = await seedBase();
    const input = {
      organizationId: org.id,
      storeId: store.id,
      customerName: "Ambiguous response customer",
      actorId: adminUser.id,
    };

    const first = await createCustomerOrderDraft({ ...input, requestId: "b0-a3-004-sale-1" });
    const second = await createCustomerOrderDraft({ ...input, requestId: "b0-a3-004-sale-2" });
    const drafts = await prisma.customerOrder.findMany({
      where: { organizationId: org.id, storeId: store.id, status: CustomerOrderStatus.DRAFT },
      orderBy: { number: "asc" },
    });

    evidence("HARD-A3-004-sales", {
      firstId: first.id,
      secondId: second.id,
      draftIds: drafts.map((draft) => draft.id),
    });

    expect(first.id).not.toBe(second.id);
    expect(drafts).toHaveLength(2);
  });

  it("reproduces HARD-A3-004: submitted purchase-order creation repeats on-order effects", async () => {
    const { org, store, supplier, product, adminUser } = await seedBase();
    const input = {
      organizationId: org.id,
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 5 }],
      actorId: adminUser.id,
      submit: true,
    };

    const first = await createPurchaseOrder({ ...input, requestId: "b0-a3-004-po-1" });
    const second = await createPurchaseOrder({ ...input, requestId: "b0-a3-004-po-2" });
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: { organizationId: org.id, storeId: store.id },
      orderBy: { createdAt: "asc" },
    });
    const snapshot = await snapshotFor(store.id, product.id);

    evidence("HARD-A3-004-purchase-orders", {
      firstId: first.id,
      secondId: second.id,
      purchaseOrderIds: purchaseOrders.map((order) => order.id),
      onOrderAfterTwoEquivalentRequests: snapshot?.onOrder,
    });

    expect(first.id).not.toBe(second.id);
    expect(purchaseOrders).toHaveLength(2);
    expect(snapshot?.onOrder).toBe(10);
  });

  it("reproduces HARD-A3-005: EXT-1 collides with EXT-10 substring identity", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 50 } });
    await seedStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      actorId: adminUser.id,
      qty: 10,
      key: "b0-a3-005-seed",
    });

    const longer = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "EXT-10",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const shorter = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "EXT-1",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const lookedUp = await getBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      identifier: "EXT-1",
    });
    const listed = await listBazaarApiOrders({
      organizationId: org.id,
      storeId: store.id,
      externalOrderId: "EXT-1",
    });
    const persistedCount = await prisma.customerOrder.count({
      where: { organizationId: org.id, storeId: store.id, source: CustomerOrderSource.API },
    });

    evidence("HARD-A3-005", {
      ext10OrderId: longer.id,
      ext1CreateResultId: shorter.id,
      ext1LookupResultId: lookedUp.id,
      ext1ListResultIds: listed.data.map((order) => order.id),
      persistedCount,
    });

    expect(shorter.id).toBe(longer.id);
    expect(lookedUp.id).toBe(longer.id);
    expect(listed.data.map((order) => order.id)).toEqual([longer.id]);
    expect(persistedCount).toBe(1);
  });

  it("verifies HARD-A3-009: sales mutations reject inactive, unassigned, and cross-org products", async () => {
    const { org, store, supplier, product, baseUnit, adminUser } = await seedBase({
      allowNegativeStock: true,
    });
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other Store", code: "OTH" },
    });
    const unassignedProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        baseUnitId: baseUnit.id,
        unit: baseUnit.code,
        sku: "B0-UNASSIGNED",
        name: "Unassigned product",
        basePriceKgs: 80,
        storeProducts: {
          create: {
            organizationId: org.id,
            storeId: otherStore.id,
            isActive: true,
          },
        },
      },
    });

    const crossOrganization = await prisma.organization.create({ data: { name: "Sales Org B" } });
    const crossOrganizationUnit = await prisma.unit.create({
      data: {
        organizationId: crossOrganization.id,
        code: "each",
        labelRu: "each",
        labelKg: "each",
      },
    });
    const crossOrganizationProduct = await prisma.product.create({
      data: {
        organizationId: crossOrganization.id,
        baseUnitId: crossOrganizationUnit.id,
        unit: crossOrganizationUnit.code,
        sku: "CROSS-ORG",
        name: "Cross organization product",
      },
    });

    await expect(
      createCustomerOrderDraft({
        organizationId: org.id,
        storeId: store.id,
        lines: [{ productId: unassignedProduct.id, qty: 1 }],
        actorId: adminUser.id,
        requestId: "b1-a3-009-initial-line",
      }),
    ).rejects.toMatchObject({ message: "productNotFound", status: 404 });
    const addLineDraft = await createCustomerOrderDraft({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b1-a3-009-empty-draft",
    });
    await expect(
      addCustomerOrderLine({
        organizationId: org.id,
        customerOrderId: addLineDraft.id,
        productId: unassignedProduct.id,
        qty: 1,
        actorId: adminUser.id,
        requestId: "b1-a3-009-add-line",
      }),
    ).rejects.toMatchObject({ message: "productNotFound", status: 404 });
    await expect(
      addCustomerOrderLine({
        organizationId: org.id,
        customerOrderId: addLineDraft.id,
        productId: crossOrganizationProduct.id,
        qty: 1,
        actorId: adminUser.id,
        requestId: "b1-a3-009-cross-org-product",
      }),
    ).rejects.toMatchObject({ message: "productNotFound", status: 404 });

    const positiveDraft = await createCustomerOrderDraft({
      organizationId: org.id,
      storeId: store.id,
      lines: [{ productId: product.id, qty: 1 }],
      actorId: adminUser.id,
      requestId: "b1-a3-009-positive",
    });
    const persistedRejectedLines = await prisma.customerOrderLine.count({
      where: { customerOrderId: addLineDraft.id },
    });
    const rejectedProductSnapshots = await prisma.inventorySnapshot.count({
      where: { storeId: store.id, productId: unassignedProduct.id },
    });
    const rejectedProductMovements = await prisma.stockMovement.count({
      where: { storeId: store.id, productId: unassignedProduct.id },
    });

    evidence("HARD-A3-009-fixed", {
      storeId: store.id,
      assignedStoreId: otherStore.id,
      productId: unassignedProduct.id,
      addLineDraftId: addLineDraft.id,
      positiveDraftId: positiveDraft.id,
      persistedRejectedLines,
      rejectedProductSnapshots,
      rejectedProductMovements,
    });

    expect(positiveDraft.id).toBeTruthy();
    expect(persistedRejectedLines).toBe(0);
    expect(rejectedProductSnapshots).toBe(0);
    expect(rejectedProductMovements).toBe(0);
    await expect(
      prisma.customerOrder.count({
        where: { organizationId: org.id, storeId: store.id },
      }),
    ).resolves.toBe(2);
  });

  it("provides HARD-A3-011 DB evidence: the return-page payload completes as an ordinary sale", async () => {
    const { org, store, product, adminUser } = await seedBase({ allowNegativeStock: true });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    await seedStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      actorId: adminUser.id,
      qty: 10,
      key: "b0-a3-011-seed",
    });

    const order = await createCustomerOrderDraft({
      organizationId: org.id,
      storeId: store.id,
      lines: [{ productId: product.id, variantId: null, qty: 1 }],
      actorId: adminUser.id,
      requestId: "b0-a3-011-return-page-create",
    });
    await confirmCustomerOrder({
      customerOrderId: order.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "b0-a3-011-confirm",
    });
    await markCustomerOrderReady({
      customerOrderId: order.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "b0-a3-011-ready",
    });
    await completeCustomerOrder({
      customerOrderId: order.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "b0-a3-011-complete",
      idempotencyKey: "b0-a3-011-complete-key",
    });

    const persisted = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    const snapshot = await snapshotFor(store.id, product.id);
    const saleMovementCount = await prisma.stockMovement.count({
      where: { referenceType: "CustomerOrder", referenceId: order.id, type: StockMovementType.SALE },
    });
    const returnCount = await prisma.saleReturn.count({ where: { originalSaleId: order.id } });

    evidence("HARD-A3-011-domain", {
      orderId: order.id,
      source: persisted.source,
      status: persisted.status,
      stockAfterCompletion: snapshot?.onHand,
      saleMovementCount,
      returnCount,
    });

    expect(persisted.source).toBe(CustomerOrderSource.MANUAL);
    expect(persisted.status).toBe(CustomerOrderStatus.COMPLETED);
    expect(snapshot?.onHand).toBe(9);
    expect(saleMovementCount).toBe(1);
    expect(returnCount).toBe(0);
  });

  it("reproduces HARD-A3-012: independent PO cancellation partially commits", async () => {
    const { org, store, supplier, product, adminUser } = await seedBase();
    const create = (requestId: string) =>
      createPurchaseOrder({
        organizationId: org.id,
        storeId: store.id,
        supplierId: supplier.id,
        lines: [{ productId: product.id, qtyOrdered: 5 }],
        actorId: adminUser.id,
        requestId,
        submit: true,
      });
    const first = await create("b0-a3-012-po-1");
    const second = await create("b0-a3-012-po-2");
    const before = await snapshotFor(store.id, product.id);
    await prisma.purchaseOrder.update({
      where: { id: second.id },
      data: { status: PurchaseOrderStatus.APPROVED, approvedAt: new Date() },
    });

    const settled = await Promise.allSettled([
      cancelPurchaseOrder({
        purchaseOrderId: first.id,
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "b0-a3-012-cancel-1",
      }),
      cancelPurchaseOrder({
        purchaseOrderId: second.id,
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "b0-a3-012-cancel-2",
      }),
    ]);

    const [persistedFirst, persistedSecond] = await Promise.all([
      prisma.purchaseOrder.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.purchaseOrder.findUniqueOrThrow({ where: { id: second.id } }),
    ]);
    const after = await snapshotFor(store.id, product.id);

    evidence("HARD-A3-012", {
      results: settled.map((result) => result.status),
      statusBefore: [PurchaseOrderStatus.SUBMITTED, PurchaseOrderStatus.APPROVED],
      statusAfter: [persistedFirst.status, persistedSecond.status],
      onOrderBefore: before?.onOrder,
      onOrderAfter: after?.onOrder,
    });

    expect(settled.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(persistedFirst.status).toBe(PurchaseOrderStatus.CANCELLED);
    expect(persistedSecond.status).toBe(PurchaseOrderStatus.APPROVED);
    expect(before?.onOrder).toBe(10);
    expect(after?.onOrder).toBe(5);
  });
});

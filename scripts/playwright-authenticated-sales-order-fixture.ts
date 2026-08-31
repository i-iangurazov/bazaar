import { CustomerOrderStatus, type PrismaClient } from "@prisma/client";

import { authenticatedE2ESeedPrefix } from "../tests/e2e/authenticated/contract";
import { authenticatedSalesOrderAcceptanceFixture as fixture } from "../tests/e2e/authenticated/sales-order-acceptance-contract";

const assertSalesOrderFixtureOwnership = async (prisma: PrismaClient) => {
  const [
    organization,
    store,
    product,
    admin,
    existingByIdentity,
    existingLine,
    additionalProduct,
    editableOrder,
    editableLine,
  ] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: fixture.organizationId },
      select: { id: true, name: true },
    }),
    prisma.store.findUnique({
      where: { id: fixture.storeId },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.product.findUnique({
      where: { id: fixture.productId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        sku: true,
        supplierId: true,
        baseUnitId: true,
      },
    }),
    prisma.user.findUnique({
      where: { email: fixture.adminEmail },
      select: { id: true, organizationId: true, name: true },
    }),
    prisma.customerOrder.findFirst({
      where: {
        OR: [
          { id: fixture.canceledOrder.id },
          { organizationId: fixture.organizationId, number: fixture.canceledOrder.number },
        ],
      },
      select: { id: true, organizationId: true, number: true },
    }),
    prisma.customerOrderLine.findUnique({
      where: { id: fixture.canceledOrder.lineId },
      select: { id: true, customerOrderId: true, productId: true },
    }),
    prisma.product.findFirst({
      where: {
        OR: [
          { id: fixture.additionalProduct.id },
          {
            organizationId: fixture.organizationId,
            sku: fixture.additionalProduct.sku,
          },
        ],
      },
      select: { id: true, organizationId: true, name: true, sku: true },
    }),
    prisma.customerOrder.findFirst({
      where: {
        OR: [
          { id: fixture.editableOrder.id },
          { organizationId: fixture.organizationId, number: fixture.editableOrder.number },
        ],
      },
      select: { id: true, organizationId: true, number: true },
    }),
    prisma.customerOrderLine.findUnique({
      where: { id: fixture.editableOrder.lineId },
      select: { id: true, customerOrderId: true, productId: true },
    }),
  ]);

  if (!organization?.name.startsWith(authenticatedE2ESeedPrefix)) {
    throw new Error("Sales-order acceptance requires the owned QA organization.");
  }
  if (
    !store ||
    store.organizationId !== fixture.organizationId ||
    !store.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Sales-order acceptance requires the owned QA store.");
  }
  if (
    !product ||
    product.organizationId !== fixture.organizationId ||
    product.sku !== fixture.productSku ||
    product.name !== fixture.productName
  ) {
    throw new Error("Sales-order acceptance requires the exact owned QA product.");
  }
  if (
    !admin ||
    admin.organizationId !== fixture.organizationId ||
    !admin.name.startsWith(authenticatedE2ESeedPrefix)
  ) {
    throw new Error("Sales-order acceptance requires the owned QA admin.");
  }
  if (
    existingByIdentity &&
    (existingByIdentity.id !== fixture.canceledOrder.id ||
      existingByIdentity.organizationId !== fixture.organizationId ||
      existingByIdentity.number !== fixture.canceledOrder.number)
  ) {
    throw new Error("Refusing to overwrite a non-QA sales order acceptance record.");
  }
  if (
    existingLine &&
    (existingLine.customerOrderId !== fixture.canceledOrder.id ||
      existingLine.productId !== fixture.productId)
  ) {
    throw new Error("Refusing to overwrite a non-QA sales order acceptance line.");
  }
  if (
    additionalProduct &&
    (additionalProduct.id !== fixture.additionalProduct.id ||
      additionalProduct.organizationId !== fixture.organizationId ||
      additionalProduct.sku !== fixture.additionalProduct.sku ||
      additionalProduct.name !== fixture.additionalProduct.name)
  ) {
    throw new Error("Refusing to overwrite a non-QA additional sales-order product.");
  }
  if (
    editableOrder &&
    (editableOrder.id !== fixture.editableOrder.id ||
      editableOrder.organizationId !== fixture.organizationId ||
      editableOrder.number !== fixture.editableOrder.number)
  ) {
    throw new Error("Refusing to overwrite a non-QA editable sales order acceptance record.");
  }
  if (
    editableLine &&
    (editableLine.customerOrderId !== fixture.editableOrder.id ||
      editableLine.productId !== fixture.productId)
  ) {
    throw new Error("Refusing to overwrite a non-QA editable sales order acceptance line.");
  }

  return {
    adminId: admin.id,
    supplierId: product.supplierId,
    baseUnitId: product.baseUnitId,
  };
};

export const seedAuthenticatedSalesOrderFixtures = async (prisma: PrismaClient) => {
  const { adminId, supplierId, baseUnitId } = await assertSalesOrderFixtureOwnership(prisma);
  const canceledAt = new Date("2026-08-31T06:30:00.000Z");

  await prisma.$transaction(async (tx) => {
    await tx.customerOrder.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        customerName: fixture.createdOrder.customerName,
      },
    });
    await tx.product.upsert({
      where: { id: fixture.additionalProduct.id },
      create: {
        id: fixture.additionalProduct.id,
        organizationId: fixture.organizationId,
        supplierId,
        baseUnitId,
        sku: fixture.additionalProduct.sku,
        name: fixture.additionalProduct.name,
        unit: "pc",
        basePriceKgs: fixture.additionalProduct.unitPriceKgs,
      },
      update: {
        organizationId: fixture.organizationId,
        supplierId,
        baseUnitId,
        sku: fixture.additionalProduct.sku,
        name: fixture.additionalProduct.name,
        unit: "pc",
        basePriceKgs: fixture.additionalProduct.unitPriceKgs,
        isDeleted: false,
      },
    });
    await tx.storeProduct.upsert({
      where: {
        storeId_productId: {
          storeId: fixture.storeId,
          productId: fixture.additionalProduct.id,
        },
      },
      create: {
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        productId: fixture.additionalProduct.id,
        isActive: true,
      },
      update: { organizationId: fixture.organizationId, isActive: true },
    });
    await tx.inventorySnapshot.upsert({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: fixture.additionalProduct.id,
          variantKey: "BASE",
        },
      },
      create: {
        storeId: fixture.storeId,
        productId: fixture.additionalProduct.id,
        variantKey: "BASE",
        onHand: 100,
      },
      update: { onHand: 100 },
    });
    await tx.customerOrder.upsert({
      where: { id: fixture.canceledOrder.id },
      create: {
        id: fixture.canceledOrder.id,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        number: fixture.canceledOrder.number,
        status: CustomerOrderStatus.CANCELED,
        customerName: fixture.canceledOrder.customerName,
        customerEmail: fixture.canceledOrder.customerEmail,
        subtotalKgs: fixture.createdOrder.unitPriceKgs,
        totalKgs: fixture.createdOrder.unitPriceKgs,
        canceledAt,
        createdById: adminId,
        updatedById: adminId,
      },
      update: {
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        number: fixture.canceledOrder.number,
        status: CustomerOrderStatus.CANCELED,
        customerName: fixture.canceledOrder.customerName,
        customerEmail: fixture.canceledOrder.customerEmail,
        customerPhone: null,
        customerAddress: null,
        confirmationEmailSentAt: null,
        trackingNumber: null,
        trackingCarrier: null,
        trackingUrl: null,
        trackingStatus: null,
        trackingAddedAt: null,
        trackingEmailSentAt: null,
        followUpEmailSentAt: null,
        subtotalKgs: fixture.createdOrder.unitPriceKgs,
        discountKgs: 0,
        totalKgs: fixture.createdOrder.unitPriceKgs,
        canceledAt,
        completedAt: null,
        updatedById: adminId,
      },
    });
    await tx.customerOrderLine.upsert({
      where: {
        customerOrderId_productId_variantKey: {
          customerOrderId: fixture.canceledOrder.id,
          productId: fixture.productId,
          variantKey: "BASE",
        },
      },
      create: {
        id: fixture.canceledOrder.lineId,
        customerOrderId: fixture.canceledOrder.id,
        productId: fixture.productId,
        variantId: null,
        variantKey: "BASE",
        qty: 1,
        unitPriceKgs: fixture.createdOrder.unitPriceKgs,
        lineTotalKgs: fixture.createdOrder.unitPriceKgs,
      },
      update: {
        variantId: null,
        qty: 1,
        unitPriceKgs: fixture.createdOrder.unitPriceKgs,
        lineTotalKgs: fixture.createdOrder.unitPriceKgs,
      },
    });
    await tx.customerOrder.upsert({
      where: { id: fixture.editableOrder.id },
      create: {
        id: fixture.editableOrder.id,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        number: fixture.editableOrder.number,
        status: CustomerOrderStatus.DRAFT,
        customerName: fixture.editableOrder.customerName,
        subtotalKgs: fixture.editableOrder.initialQuantity * fixture.createdOrder.unitPriceKgs,
        totalKgs: fixture.editableOrder.initialQuantity * fixture.createdOrder.unitPriceKgs,
        createdById: adminId,
        updatedById: adminId,
      },
      update: {
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        number: fixture.editableOrder.number,
        status: CustomerOrderStatus.DRAFT,
        customerName: fixture.editableOrder.customerName,
        customerEmail: null,
        customerPhone: null,
        customerAddress: null,
        notes: null,
        subtotalKgs: fixture.editableOrder.initialQuantity * fixture.createdOrder.unitPriceKgs,
        discountKgs: 0,
        totalKgs: fixture.editableOrder.initialQuantity * fixture.createdOrder.unitPriceKgs,
        confirmedAt: null,
        readyAt: null,
        completedAt: null,
        canceledAt: null,
        updatedById: adminId,
      },
    });
    await tx.customerOrderLine.deleteMany({
      where: {
        customerOrderId: fixture.editableOrder.id,
        id: { not: fixture.editableOrder.lineId },
      },
    });
    await tx.customerOrderLine.upsert({
      where: {
        customerOrderId_productId_variantKey: {
          customerOrderId: fixture.editableOrder.id,
          productId: fixture.productId,
          variantKey: "BASE",
        },
      },
      create: {
        id: fixture.editableOrder.lineId,
        customerOrderId: fixture.editableOrder.id,
        productId: fixture.productId,
        variantId: null,
        variantKey: "BASE",
        qty: fixture.editableOrder.initialQuantity,
        unitPriceKgs: fixture.createdOrder.unitPriceKgs,
        lineTotalKgs: fixture.editableOrder.initialQuantity * fixture.createdOrder.unitPriceKgs,
      },
      update: {
        variantId: null,
        qty: fixture.editableOrder.initialQuantity,
        unitPriceKgs: fixture.createdOrder.unitPriceKgs,
        lineTotalKgs: fixture.editableOrder.initialQuantity * fixture.createdOrder.unitPriceKgs,
      },
    });
    await tx.customerOrderEmailLog.deleteMany({
      where: { customerOrderId: fixture.canceledOrder.id },
    });
    await tx.auditLog.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        entity: "CustomerOrder",
        entityId: { in: [fixture.canceledOrder.id, fixture.editableOrder.id] },
      },
    });
  });
};

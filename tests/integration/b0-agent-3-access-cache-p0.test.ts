import type { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as getBazaarApiProducts } from "@/app/api/bazaar/v1/products/route";
import { prisma } from "@/server/db/prisma";
import {
  authenticateBazaarApiRequest,
  createBazaarApiKey,
  listBazaarApiProducts,
  revokeBazaarApiKey,
} from "@/server/services/bazaarApi";
import { createCustomerOrderDraft } from "@/server/services/salesOrders";
import { adjustStock } from "@/server/services/inventory";
import { createPurchaseOrder } from "@/server/services/purchaseOrders";
import { upsertStorePrice } from "@/server/services/storePrices";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const evidence = (issueId: string, payload: Record<string, unknown>) => {
  console.info(`[B0-EVIDENCE] ${issueId} ${JSON.stringify(payload)}`);
};

const asCallerUser = (user: {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner?: boolean | null;
}) => {
  if (!user.organizationId) {
    throw new Error("test user must belong to an organization");
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: Boolean(user.isOrgOwner),
  };
};

const createSecondStoreProduct = async (input: {
  organizationId: string;
  supplierId: string;
  baseUnitId: string;
  unitCode: string;
}) => {
  const store = await prisma.store.create({
    data: {
      organizationId: input.organizationId,
      name: "Store B",
      code: "STB",
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: input.organizationId,
      supplierId: input.supplierId,
      baseUnitId: input.baseUnitId,
      unit: input.unitCode,
      sku: "B0-STORE-B",
      name: "Store B Product",
      basePriceKgs: 145,
      storeProducts: {
        create: {
          organizationId: input.organizationId,
          storeId: store.id,
          isActive: true,
        },
      },
    },
  });
  return { store, product };
};

describeDb("B0 Agent 3 access and cache P0 runtime verification", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("verifies HARD-A3-002: a warmed API key is rejected immediately after revocation", async () => {
    const { org, store, adminUser } = await seedBase();
    const { apiKey, token } = await createBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b0-a3-002-key",
      name: "B0 revocation key",
    });
    const { apiKey: unaffectedApiKey, token: unaffectedToken } = await createBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b1-a3-002-unaffected-key",
      name: "B1 unaffected key",
    });
    const otherOrganization = await prisma.organization.create({
      data: { name: "Other organization" },
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrganization.id,
        name: "Other organization store",
        code: "OTHER",
      },
    });
    const request = () =>
      new Request("http://localhost/api/bazaar/v1/products", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });

    const warmed = await authenticateBazaarApiRequest(request());
    await expect(
      revokeBazaarApiKey({
        organizationId: otherOrganization.id,
        storeId: otherStore.id,
        actorId: adminUser.id,
        requestId: "b1-a3-002-cross-org-tamper",
        apiKeyId: apiKey.id,
      }),
    ).rejects.toMatchObject({ message: "apiKeyNotFound", status: 404 });
    await expect(authenticateBazaarApiRequest(request())).resolves.toMatchObject({
      apiKeyId: apiKey.id,
    });
    await revokeBazaarApiKey({
      organizationId: org.id,
      storeId: store.id,
      actorId: adminUser.id,
      requestId: "b0-a3-002-revoke",
      apiKeyId: apiKey.id,
    });
    const persisted = await prisma.bazaarApiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    const directApiResponse = await getBazaarApiProducts(request());
    const unaffectedContext = await authenticateBazaarApiRequest(
      new Request("http://localhost/api/bazaar/v1/products", {
        method: "GET",
        headers: { authorization: `Bearer ${unaffectedToken}` },
      }),
    );

    evidence("HARD-A3-002-fixed", {
      apiKeyId: apiKey.id,
      warmedContextApiKeyId: warmed.apiKeyId,
      revokedAt: persisted.revokedAt?.toISOString(),
      directApiStatusAfterRevoke: directApiResponse.status,
      unaffectedApiKeyId: unaffectedContext.apiKeyId,
      cacheMode: process.env.REDIS_URL ? "database-plus-agent3-redis-cleanup" : "database-only",
    });

    expect(persisted.revokedAt).toBeInstanceOf(Date);
    await expect(authenticateBazaarApiRequest(request())).rejects.toMatchObject({
      message: "apiUnauthorized",
      code: "UNAUTHORIZED",
      status: 401,
    });
    expect(directApiResponse.status).toBe(401);
    await expect(directApiResponse.json()).resolves.toEqual({ message: "apiUnauthorized" });
    expect(unaffectedContext.apiKeyId).toBe(unaffectedApiKey.id);
  });

  it("reproduces HARD-A3-006: customer list/detail/upsert cross Store A and Store B", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    const storeB = await prisma.store.create({
      data: { organizationId: org.id, name: "Store B", code: "STB" },
    });
    const storeBCustomer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        name: "Store B Customer",
        email: "same@example.com",
        address: "Store B address",
      },
    });
    const caller = createTestCaller(asCallerUser(managerUser));

    const storeAList = await caller.customers.list({
      storeId: store.id,
      search: "same@example.com",
      page: 1,
      pageSize: 25,
    });
    const detail = await caller.customers.detail({ customerId: storeBCustomer.id });
    const draft = await createCustomerOrderDraft({
      organizationId: org.id,
      storeId: store.id,
      customerName: "Store A order customer",
      customerEmail: "same@example.com",
      actorId: managerUser.id,
      requestId: "b0-a3-006-order",
    });
    const customersAfter = await prisma.customer.findMany({
      where: { organizationId: org.id, email: "same@example.com" },
      orderBy: { createdAt: "asc" },
    });

    evidence("HARD-A3-006", {
      requestedStoreId: store.id,
      leakedListStoreIds: storeAList.items.map((customer) => customer.storeId),
      detailCustomerStoreId: detail.customer.storeId,
      orderStoreId: draft.storeId,
      persistedCustomerStoreIds: customersAfter.map((customer) => customer.storeId),
      persistedOrderCounts: customersAfter.map((customer) => customer.orderCount),
    });

    expect(storeAList.items.map((customer) => customer.id)).toContain(storeBCustomer.id);
    expect(detail.customer.id).toBe(storeBCustomer.id);
    expect(customersAfter).toHaveLength(1);
    expect(customersAfter[0]).toMatchObject({
      id: storeBCustomer.id,
      storeId: storeB.id,
      orderCount: 1,
    });
  });

  it("reproduces HARD-A3-007: route-forbidden roles read POs/suppliers and a Store A manager cancels Store B", async () => {
    const { org, store, supplier, product, baseUnit, adminUser, managerUser, staffUser, cashierUser } =
      await seedBase({ plan: "BUSINESS" });
    const { store: storeB } = await createSecondStoreProduct({
      organizationId: org.id,
      supplierId: supplier.id,
      baseUnitId: baseUnit.id,
      unitCode: baseUnit.code,
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        productId: product.id,
        isActive: true,
      },
    });
    const po = await createPurchaseOrder({
      organizationId: org.id,
      storeId: storeB.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 5 }],
      actorId: adminUser.id,
      requestId: "b0-a3-007-po",
      submit: true,
    });
    const before = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: storeB.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    const staffCaller = createTestCaller(asCallerUser(staffUser));
    const cashierCaller = createTestCaller(asCallerUser(cashierUser));
    const managerCaller = createTestCaller(asCallerUser(managerUser));
    const [staffList, staffDetail, cashierSuppliers] = await Promise.all([
      staffCaller.purchaseOrders.list({ page: 1, pageSize: 25 }),
      staffCaller.purchaseOrders.getById({ id: po.id }),
      cashierCaller.suppliers.list(),
    ]);
    await managerCaller.purchaseOrders.cancel({ purchaseOrderId: po.id });

    const persisted = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    const after = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: storeB.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    evidence("HARD-A3-007", {
      managerAccessibleStoreId: store.id,
      targetStoreId: storeB.id,
      staffListOrderIds: staffList.items.map((order) => order.id),
      staffDetailOrderId: staffDetail?.id,
      cashierSupplierIds: cashierSuppliers.map((row) => row.id),
      targetStatusAfterManagerCancel: persisted.status,
      targetOnOrderBefore: before.onOrder,
      targetOnOrderAfter: after.onOrder,
    });

    expect(staffList.items.map((order) => order.id)).toContain(po.id);
    expect(staffDetail?.id).toBe(po.id);
    expect(cashierSuppliers.map((row) => row.id)).toContain(supplier.id);
    expect(persisted.status).toBe("CANCELLED");
    expect(before.onOrder).toBe(5);
    expect(after.onOrder).toBe(0);
  });

  it("reproduces HARD-A3-008: limited roles read integrations and a Store A manager mutates Store B selection", async () => {
    const { org, store, supplier, baseUnit, managerUser, staffUser, cashierUser } = await seedBase({
      plan: "BUSINESS",
    });
    const { store: storeB, product: productB } = await createSecondStoreProduct({
      organizationId: org.id,
      supplierId: supplier.id,
      baseUnitId: baseUnit.id,
      unitCode: baseUnit.code,
    });
    const staffCaller = createTestCaller(asCallerUser(staffUser));
    const cashierCaller = createTestCaller(asCallerUser(cashierUser));
    const managerCaller = createTestCaller(asCallerUser(managerUser));

    const successfulReads: string[] = [];
    await staffCaller.bazaarCatalog.listStores();
    successfulReads.push("staff:bazaarCatalog.listStores");
    await staffCaller.bazaarCatalog.getSettings({ storeId: store.id });
    successfulReads.push("staff:bazaarCatalog.getSettings");
    await staffCaller.mMarket.overview();
    successfulReads.push("staff:mMarket.overview");
    await staffCaller.bakaiStore.overview();
    successfulReads.push("staff:bakaiStore.overview");
    await cashierCaller.oMarket.overview();
    successfulReads.push("cashier:oMarket.overview");
    await cashierCaller.productImageStudio.overview();
    successfulReads.push("cashier:productImageStudio.overview");

    const selectionResult = await managerCaller.mMarket.updateProducts({
      storeId: storeB.id,
      productIds: [productB.id],
      included: true,
    });
    const persistedSelection = await prisma.mMarketIncludedProduct.findUnique({
      where: {
        orgId_storeId_productId: {
          orgId: org.id,
          storeId: storeB.id,
          productId: productB.id,
        },
      },
    });

    evidence("HARD-A3-008", {
      successfulReads,
      managerAccessibleStoreId: store.id,
      targetStoreId: storeB.id,
      selectionResult,
      persistedSelectionId: persistedSelection?.id,
      externalFetchCalls: 0,
    });

    expect(successfulReads).toHaveLength(6);
    expect(selectionResult).toEqual({ updatedCount: 1 });
    expect(persistedSelection).not.toBeNull();
  });

  it("reproduces HARD-A3-010: warmed API product data ignores committed price and stock mutations", async () => {
    const { org, store, product, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.product.update({ where: { id: product.id }, data: { basePriceKgs: 100 } });
    await adjustStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 10,
      reason: "b0-a3-010-seed",
      actorId: adminUser.id,
      requestId: "b0-a3-010-seed",
      idempotencyKey: "b0-a3-010-seed-key",
    });

    const first = await listBazaarApiProducts({
      organizationId: org.id,
      storeId: store.id,
      page: 1,
      pageSize: 50,
    });
    await upsertStorePrice({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      priceKgs: 200,
      actorId: adminUser.id,
      requestId: "b0-a3-010-price",
    });
    await adjustStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: -3,
      reason: "b0-a3-010-stock-change",
      actorId: adminUser.id,
      requestId: "b0-a3-010-stock-change",
      idempotencyKey: "b0-a3-010-stock-change-key",
    });
    const second = await listBazaarApiProducts({
      organizationId: org.id,
      storeId: store.id,
      page: 1,
      pageSize: 50,
    });
    const databasePrice = await prisma.storePrice.findUniqueOrThrow({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId: org.id,
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    const databaseSnapshot = await prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    const firstItem = first.items.find((item) => item.id === product.id);
    const secondItem = second.items.find((item) => item.id === product.id);

    evidence("HARD-A3-010", {
      productId: product.id,
      firstApiPriceKgs: firstItem?.priceKgs,
      secondApiPriceKgs: secondItem?.priceKgs,
      databasePriceKgs: Number(databasePrice.priceKgs),
      firstApiStockQty: firstItem?.stockQty,
      secondApiStockQty: secondItem?.stockQty,
      databaseStockQty: databaseSnapshot.onHand,
      cacheMode: process.env.REDIS_URL ? "memory-plus-agent3-redis" : "memory-only",
    });

    expect(firstItem).toMatchObject({ priceKgs: 100, stockQty: 10 });
    expect(secondItem).toMatchObject({ priceKgs: 100, stockQty: 10 });
    expect(Number(databasePrice.priceKgs)).toBe(200);
    expect(databaseSnapshot.onHand).toBe(7);
  });
});

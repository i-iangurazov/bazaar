import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { postStockReceiving, postStockWriteOff, transferStock } from "@/server/services/inventory";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("inventory product presentation is isolated and read-only", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE" });
    await prisma.unit.update({ where: { id: f.baseUnit.id }, data: { quantityPrecision: 3 } });
    await prisma.product.update({
      where: { id: f.product.id },
      data: { photoUrl: "/uploads/legacy.webp" },
    });
    await prisma.productImage.createMany({
      data: [
        {
          organizationId: f.org.id,
          productId: f.product.id,
          url: "/uploads/second.webp",
          position: 2,
        },
        {
          organizationId: f.org.id,
          productId: f.product.id,
          url: "/uploads/first.webp",
          position: 0,
        },
      ],
    });
    await prisma.productBarcode.create({
      data: { organizationId: f.org.id, productId: f.product.id, value: "123456789" },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const business = {
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "presentation-test",
    };
    return { ...f, caller, business };
  }
  const stockState = async () => ({
    snapshots: await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } }),
    movements: await prisma.stockMovement.findMany({ orderBy: { id: "asc" } }),
    costs: await prisma.productCost.findMany({ orderBy: { id: "asc" } }),
    prices: await prisma.storePrice.findMany({ orderBy: { id: "asc" } }),
    assignments: await prisma.storeProduct.findMany({ orderBy: { id: "asc" } }),
    lots: await prisma.stockLot.findMany({ orderBy: { id: "asc" } }),
  });
  it("returns exact source-card images and identifiers with zero stock/price/history changes", async () => {
    const f = await fixture();
    await postStockReceiving({
      ...f.business,
      storeId: f.store.id,
      lines: [{ productId: f.product.id, quantity: 7.5, unitCost: 12.34 }],
      idempotencyKey: "photo-receiving",
    });
    const copy = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: f.product.name,
        sku: "SAME-NAME-COPY",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        photoUrl: "/uploads/wrong-copy.webp",
      },
    });
    const before = await stockState();
    const result = await f.caller.inventory.productPresentation({
      storeId: f.store.id,
      productIds: [f.product.id, f.product.id, copy.id],
    });
    expect(result).toEqual([
      {
        productId: f.product.id,
        imageUrl: "/uploads/first.webp",
        sku: f.product.sku,
        barcode: "123456789",
      },
      { productId: copy.id, imageUrl: null, sku: "", barcode: null },
    ]);
    expect(await stockState()).toEqual(before);
  });
  it("refreshes current images, handles removal and keeps a legacy photo fallback", async () => {
    const f = await fixture();
    const input = { storeId: f.store.id, productIds: [f.product.id] };
    await prisma.productImage.deleteMany({ where: { productId: f.product.id } });
    expect((await f.caller.inventory.productPresentation(input))[0].imageUrl).toBe(
      "/uploads/legacy.webp",
    );
    await prisma.product.update({ where: { id: f.product.id }, data: { photoUrl: null } });
    expect((await f.caller.inventory.productPresentation(input))[0].imageUrl).toBeNull();
    await prisma.productImage.create({
      data: { organizationId: f.org.id, productId: f.product.id, url: "/uploads/updated.webp" },
    });
    expect((await f.caller.inventory.productPresentation(input))[0].imageUrl).toBe(
      "/uploads/updated.webp",
    );
  });
  it("keeps historical read access after subscription expiry while stock writes stay blocked", async () => {
    const f = await fixture();
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        subscriptionStatus: "CANCELED",
        trialEndsAt: new Date("2020-01-01"),
        currentPeriodEndsAt: new Date("2020-01-01"),
      },
    });
    expect(
      (
        await f.caller.inventory.productPresentation({
          storeId: f.store.id,
          productIds: [f.product.id],
        })
      )[0].imageUrl,
    ).toBe("/uploads/first.webp");
    await expect(
      f.caller.inventory.postStockReceiving({
        storeId: f.store.id,
        lines: [{ productId: f.product.id, quantity: 1, unitCost: 0 }],
        idempotencyKey: "expired-stock-write",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.stockMovement.count()).toBe(0);
  });
  it("accepts one bounded 500-product batch and rejects an oversized request", async () => {
    const f = await fixture();
    const productIds = [
      f.product.id,
      ...Array.from({ length: 499 }, (_, index) => `missing-${index}`),
    ];
    const result = await f.caller.inventory.productPresentation({
      storeId: f.store.id,
      productIds,
    });
    expect(result).toHaveLength(500);
    expect(result[0].imageUrl).toBe("/uploads/first.webp");
    expect(result.slice(1).every((row) => row.imageUrl === null && row.sku === "")).toBe(true);
    await expect(
      f.caller.inventory.productPresentation({
        storeId: f.store.id,
        productIds: [...productIds, "over-limit"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("loads archived historical cards in receiving, transfer and write-off without granting new assortment", async () => {
    const f = await fixture();
    const received = await postStockReceiving({
      ...f.business,
      storeId: f.store.id,
      lines: [{ productId: f.product.id, quantity: 20, unitCost: 0 }],
      idempotencyKey: "presentation-received",
    });
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Recipient", code: "DST" },
    });
    const transferred = await transferStock({
      ...f.business,
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      lines: [{ productId: f.product.id, qty: 3 }],
      idempotencyKey: "presentation-transferred",
    });
    const writtenOff = await postStockWriteOff({
      ...f.business,
      storeId: f.store.id,
      reason: "Порча",
      lines: [{ productId: f.product.id, qty: 2 }],
      idempotencyKey: "presentation-written-off",
    });
    await prisma.product.update({ where: { id: f.product.id }, data: { isDeleted: true } });
    await prisma.storeProduct.updateMany({
      where: { productId: f.product.id },
      data: { isActive: false },
    });
    const before = await stockState();
    expect(
      (
        await f.caller.inventory.productPresentation({
          storeId: f.store.id,
          productIds: [f.product.id],
        })
      )[0].imageUrl,
    ).toBeNull();
    for (const documentKey of [
      `STOCK_RECEIVING:STOCK_RECEIVING:${received.receivingId}`,
      `TRANSFER:TRANSFER:${transferred.transferId}`,
      `WRITE_OFF:WRITE_OFF:${writtenOff.writeOffId}`,
    ]) {
      expect(
        (
          await f.caller.inventory.productPresentation({
            storeId: f.store.id,
            productIds: [f.product.id],
            documentKey,
          })
        )[0].imageUrl,
      ).toBe("/uploads/first.webp");
    }
    expect(await stockState()).toEqual(before);
  });
  it("enforces roles, store/org isolation and exact historical document membership", async () => {
    const f = await fixture();
    const foreignOrg = await prisma.organization.create({
      data: { name: "Foreign org", plan: "ENTERPRISE" },
    });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreignOrg.id, name: "Foreign", code: "FOREIGN" },
    });
    const foreignUnit = await prisma.unit.create({
      data: { organizationId: foreignOrg.id, code: "each", labelRu: "шт", labelKg: "даана" },
    });
    const foreignProduct = await prisma.product.create({
      data: {
        organizationId: foreignOrg.id,
        name: "Private foreign product",
        sku: "FOREIGN",
        unit: "each",
        baseUnitId: foreignUnit.id,
        photoUrl: "/uploads/foreign.webp",
      },
    });
    const foreignAdmin = await prisma.user.create({
      data: {
        organizationId: foreignOrg.id,
        email: "foreign-photo@example.test",
        name: "Foreign photo admin",
        role: "ADMIN",
        passwordHash: "hash",
      },
    });
    const foreign = {
      org: foreignOrg,
      store: foreignStore,
      product: foreignProduct,
      adminUser: foreignAdmin,
    };
    const input = { storeId: f.store.id, productIds: [f.product.id, foreign.product.id] };
    expect((await f.caller.inventory.productPresentation(input))[1]).toEqual({
      productId: foreign.product.id,
      imageUrl: null,
      sku: "",
      barcode: null,
    });
    await expect(
      createTestCaller({
        ...f.cashierUser,
        organizationId: f.org.id,
      }).inventory.productPresentation(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await expect(
      createTestCaller({
        ...f.managerUser,
        organizationId: f.org.id,
      }).inventory.productPresentation(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.userStoreAccess.create({
      data: { organizationId: f.org.id, userId: f.managerUser.id, storeId: f.store.id },
    });
    expect(
      (
        await createTestCaller({
          ...f.managerUser,
          organizationId: f.org.id,
        }).inventory.productPresentation(input)
      )[0].imageUrl,
    ).toBe("/uploads/first.webp");
    await expect(
      f.caller.inventory.productPresentation({ ...input, storeId: foreign.store.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const received = await postStockReceiving({
      ...f.business,
      storeId: f.store.id,
      lines: [{ productId: f.product.id, quantity: 1, unitCost: 0 }],
      idempotencyKey: "historical-members",
    });
    const other = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "UNRELATED",
        name: "Unrelated archived card",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        isDeleted: true,
        photoUrl: "/uploads/private.webp",
      },
    });
    const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${received.receivingId}`;
    expect(
      (
        await f.caller.inventory.productPresentation({
          storeId: f.store.id,
          productIds: [other.id],
          documentKey,
        })
      )[0].imageUrl,
    ).toBeNull();
    await expect(
      createTestCaller({
        ...foreign.adminUser,
        organizationId: foreign.org.id,
      }).inventory.productPresentation({
        storeId: foreign.store.id,
        productIds: [f.product.id],
        documentKey,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

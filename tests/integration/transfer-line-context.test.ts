import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { transferStock } from "@/server/services/inventory";
import { reconcileTransferAttempt } from "@/server/services/transferRecovery";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("transfer validation and product identity", () => {
  beforeEach(resetDatabase);
  it("closes an uncertain unposted attempt so a late original request cannot move stock", async () => {
    const f = await seedBase();
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Destination", code: "DST" },
    });
    const input = {
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "close-before-post",
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      idempotencyKey: "closed-before-effect",
    };
    expect(await reconcileTransferAttempt(input)).toMatchObject({ status: "CANCELED" });
    await expect(
      transferStock({ ...input, lines: [{ productId: f.product.id, qty: 1 }] }),
    ).rejects.toMatchObject({ message: "transferAttemptClosed" });
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await reconcileTransferAttempt(input)).toMatchObject({ status: "CANCELED" });
  });
  it("serializes recovery against an original request racing to post", async () => {
    const f = await seedBase();
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Destination", code: "DST" },
    });
    const input = {
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "recovery-race",
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      idempotencyKey: "racing-transfer-key",
    };
    const [posted, recovered] = await Promise.allSettled([
      transferStock({ ...input, lines: [{ productId: f.product.id, qty: 1 }] }),
      reconcileTransferAttempt(input),
    ]);
    expect(recovered.status).toBe("fulfilled");
    if (recovered.status !== "fulfilled") throw recovered.reason;
    if (recovered.value.status === "POSTED") {
      expect(posted.status).toBe("fulfilled");
      expect(await prisma.stockMovement.count()).toBe(2);
      expect(
        (await transferStock({ ...input, lines: [{ productId: f.product.id, qty: 1 }] }))
          .transferId,
      ).toBe(recovered.value.transferId);
      expect(await prisma.stockMovement.count()).toBe(2);
    } else {
      expect(posted.status).toBe("rejected");
      await expect(
        transferStock({ ...input, lines: [{ productId: f.product.id, qty: 1 }] }),
      ).rejects.toMatchObject({ message: "transferAttemptClosed" });
      expect(await prisma.stockMovement.count()).toBe(0);
    }
  });
  it("reads a missing destination as zero, preserves identity and creates no records during validation", async () => {
    const f = await seedBase();
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Destination", code: "DST" },
    });
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 100 },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const lines = [{ productId: f.product.id, variantId: null }];
    const result = await caller.inventory.transferLineContext({
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      lines,
    });
    expect(result[0]).toMatchObject({
      available: true,
      sourceStock: 100,
      destinationStock: 0,
      destinationInAssortment: false,
    });
    expect(await prisma.inventorySnapshot.count()).toBe(1);
    expect(await prisma.storeProduct.count()).toBe(1);
    const request = {
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "transfer-context",
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      lines: [{ productId: f.product.id, qty: 1 }],
      idempotencyKey: "context-transfer-once",
    };
    const transfer = await transferStock(request);
    expect(await reconcileTransferAttempt(request)).toEqual({
      status: "POSTED",
      transferId: transfer.transferId,
    });
    expect((await transferStock(request)).transferId).toBe(transfer.transferId);
    const updated = await caller.inventory.transferLineContext({
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      lines,
    });
    expect(updated[0]).toMatchObject({
      sourceStock: 99,
      destinationStock: 1,
      destinationInAssortment: true,
    });
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.stockMovement.count()).toBe(2);
    expect(
      (await caller.products.list({ storeId: destination.id })).items.map((p) => p.id),
    ).toContain(f.product.id);
  });
  it("marks missing source assignments and archived variants unavailable without leaking cross-organization products", async () => {
    const f = await seedBase();
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Destination", code: "DST" },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const variant = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "Inactive", attributes: {}, isActive: false },
    });
    const lines = [
      { productId: f.product.id, variantId: variant.id },
      { productId: "another-organization-product" },
    ];
    expect(
      await caller.inventory.transferLineContext({
        fromStoreId: f.store.id,
        toStoreId: destination.id,
        lines,
      }),
    ).toEqual(
      lines.map((l) => ({
        key: `${l.productId}:${"variantId" in l ? l.variantId : "BASE"}`,
        available: false,
      })),
    );
    expect(
      (
        await caller.inventory.transferLineContext({
          fromStoreId: destination.id,
          toStoreId: f.store.id,
          lines: [{ productId: f.product.id }],
        })
      )[0].available,
    ).toBe(false);
    await expect(
      createTestCaller({
        ...f.managerUser,
        organizationId: f.org.id,
      }).inventory.transferLineContext({
        fromStoreId: f.store.id,
        toStoreId: destination.id,
        lines,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createTestCaller({
        ...f.cashierUser,
        organizationId: f.org.id,
      }).inventory.transferLineContext({ fromStoreId: f.store.id, toStoreId: f.store.id, lines }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps explicitly excluded assortment excluded while recording both sides of the transfer", async () => {
    const f = await seedBase();
    await prisma.storeProduct.updateMany({
      where: { storeId: f.store.id, productId: f.product.id },
      data: { isDirect: true, isHistorical: false },
    });
    const destination = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Restricted", code: "RST" },
    });
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const change = (await caller.stores.catalogSettings({ storeId: destination.id })).settings!;
    change.connections.push({
      key: `store:${f.store.id}`,
      enabled: false,
      scope: "ALL",
      productIds: [],
    });
    const preview = await caller.stores.previewCatalogSettings(change);
    await caller.stores.saveCatalogSettings({
      change,
      token: preview.token,
      idempotencyKey: "configure-excluded",
    });
    const input = {
      fromStoreId: f.store.id,
      toStoreId: destination.id,
      lines: [{ productId: f.product.id }],
    };
    expect((await caller.inventory.transferLineContext(input))[0]).toMatchObject({
      available: true,
      destinationRequiresAssortment: true,
    });
    await transferStock({
      ...input,
      lines: [{ productId: f.product.id, qty: 1 }],
      organizationId: f.org.id,
      actorId: f.adminUser.id,
      requestId: "excluded-transfer",
      idempotencyKey: "excluded-transfer-once",
    });
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: destination.id, productId: f.product.id },
        })
      ).onHand,
    ).toBe(1);
    expect(
      (await caller.products.list({ storeId: destination.id })).items.map((p) => p.id),
    ).not.toContain(f.product.id);
    expect(await prisma.product.count()).toBe(1);
  });

  it("distinguishes separate SKUs and active variants without a phantom base row for inactive variants", async () => {
    const f = await seedBase();
    const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const duplicate = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: f.product.name,
        sku: "OTHER-SKU",
        baseUnitId: f.baseUnit.id,
        unit: "each",
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: duplicate.id },
    });
    const inactive = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "Old", attributes: {}, isActive: false },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        variantId: inactive.id,
        variantKey: inactive.id,
        onHand: 5,
      },
    });
    const results = await caller.inventory.searchProducts({
      storeId: f.store.id,
      search: f.product.name,
      limit: 100,
    });
    expect(results.map((row) => row.product.id)).toEqual([duplicate.id]);
    const active = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "XL", attributes: {}, isActive: true },
    });
    await prisma.inventorySnapshot.create({
      data: {
        storeId: f.store.id,
        productId: f.product.id,
        variantId: active.id,
        variantKey: active.id,
        onHand: 7,
      },
    });
    const choices = await caller.inventory.searchProducts({
      storeId: f.store.id,
      search: f.product.name,
      limit: 100,
    });
    expect(choices).toHaveLength(2);
    expect(
      new Set(choices.map((row) => `${row.product.id}:${row.snapshot.variantId ?? "BASE"}`)).size,
    ).toBe(2);
    expect(choices.find((row) => row.product.id === f.product.id)?.variant?.name).toBe("XL");
    expect(
      await prisma.inventorySnapshot.count({ where: { variantId: inactive.id, onHand: 5 } }),
    ).toBe(1);
  });
});

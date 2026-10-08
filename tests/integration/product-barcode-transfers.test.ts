import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("archived product barcode transfers", () => {
  beforeEach(resetDatabase);
  const setup = async () => {
    const fixture = await seedBase({ plan: "BUSINESS" });
    const { org, adminUser, store, baseUnit } = fixture;
    const caller = createTestCaller({ ...adminUser, organizationId: org.id });
    const source = await caller.products.create({
      idempotencyKey: "barcode-transfer-source",
      name: "Old burner",
      sku: "OLD-BURNER",
      storeId: store.id,
      baseUnitId: baseUnit.id,
      initialOnHand: 2,
      barcodes: ["6952348364235", "KEEP-OLD-CODE"],
    });
    const input = {
      idempotencyKey: "barcode-transfer-new",
      name: "New burner",
      sku: "NEW-BURNER",
      storeId: store.id,
      baseUnitId: baseUnit.id,
      barcodes: ["6952348364235"],
      barcodeTransfers: [{ sourceProductId: source.id, barcode: "6952348364235" }],
    };
    return { ...fixture, caller, source, input };
  };

  it("keeps an archived code reserved until explicitly transferred and preserves history and replay", async () => {
    const { org, store, caller, source, input } = await setup();
    const history = await prisma.stockMovement.findMany({ where: { productId: source.id } });
    expect(history.length).toBeGreaterThan(0);
    await caller.products.archive({ productId: source.id });
    expect(
      (await caller.products.list({ storeId: store.id, search: input.barcodes[0] })).total,
    ).toBe(0);
    const diagnostics = await caller.products.duplicateDiagnostics({ barcodes: input.barcodes });
    expect(diagnostics.exactBarcodeMatches[0]).toMatchObject({
      id: source.id,
      isDeleted: true,
      canTransfer: true,
    });
    const ordinaryInput = { ...input, barcodeTransfers: undefined };
    await expect(caller.products.create(ordinaryInput)).rejects.toMatchObject({
      message: "barcodeExists",
    });
    const target = await caller.products.create({
      ...input,
      idempotencyKey: "barcode-transfer-consented",
    });
    expect(
      (await caller.products.create({ ...input, idempotencyKey: "barcode-transfer-consented" })).id,
    ).toBe(target.id);
    expect(
      await prisma.productBarcode.findUnique({
        where: { organizationId_value: { organizationId: org.id, value: input.barcodes[0] } },
      }),
    ).toMatchObject({ productId: target.id });
    expect(await prisma.product.findUnique({ where: { id: source.id } })).toMatchObject({
      isDeleted: true,
    });
    expect(await prisma.stockMovement.findMany({ where: { productId: source.id } })).toEqual(
      history,
    );
    expect(
      (await prisma.productBarcode.findMany({ where: { productId: source.id } })).map(
        (b) => b.value,
      ),
    ).toEqual(["KEEP-OLD-CODE"]);
    expect((await caller.products.lookupScan({ q: input.barcodes[0] })).items[0].id).toBe(
      target.id,
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: source.id, action: "PRODUCT_BARCODE_TRANSFER" },
      }),
    ).toBe(1);
  });

  it("rejects taking a code from an active or newly restored product", async () => {
    const { caller, source, input } = await setup();
    expect(
      (await caller.products.duplicateDiagnostics({ barcodes: input.barcodes }))
        .exactBarcodeMatches[0].canTransfer,
    ).toBe(false);
    await expect(caller.products.create(input)).rejects.toMatchObject({
      message: "barcodeTransferUnavailable",
    });
    await caller.products.archive({ productId: source.id });
    await caller.products.restore({ productId: source.id });
    await expect(
      caller.products.create({ ...input, idempotencyKey: "barcode-transfer-restored" }),
    ).rejects.toMatchObject({ message: "barcodeTransferUnavailable" });
    expect(await prisma.productBarcode.count({ where: { productId: source.id } })).toBe(2);
  });

  it("rolls the transfer back when the receiving product cannot be saved", async () => {
    const { caller, source, input, product } = await setup();
    await caller.products.archive({ productId: source.id });
    await expect(caller.products.create({ ...input, sku: product.sku })).rejects.toBeDefined();
    expect(await prisma.productBarcode.count({ where: { productId: source.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_BARCODE_TRANSFER" } })).toBe(0);
  });

  it("allows only one receiving product when two saves compete for the same archived code", async () => {
    const { caller, source, input, org } = await setup();
    await caller.products.archive({ productId: source.id });
    const results = await Promise.allSettled([
      caller.products.create(input),
      caller.products.create({
        ...input,
        idempotencyKey: "barcode-transfer-competing",
        sku: "OTHER-BURNER",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const winner = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      id: string;
    }>;
    expect(
      await prisma.productBarcode.findUnique({
        where: { organizationId_value: { organizationId: org.id, value: input.barcodes[0] } },
      }),
    ).toMatchObject({ productId: winner.value.id });
  });

  it("denies a forged transfer from a store the manager cannot access", async () => {
    const { caller, org, managerUser, source, input } = await setup();
    const otherStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Other store", code: "OTHER" },
    });
    await prisma.storeProduct.updateMany({
      where: { productId: source.id },
      data: { storeId: otherStore.id },
    });
    await caller.products.archive({ productId: source.id });
    const manager = createTestCaller({ ...managerUser, organizationId: org.id });
    expect(
      (await manager.products.duplicateDiagnostics({ barcodes: input.barcodes }))
        .exactBarcodeMatches[0],
    ).toMatchObject({ canAccess: false, canTransfer: false });
    await expect(manager.products.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.productBarcode.count({ where: { productId: source.id } })).toBe(2);
  });

  it("allows a manager to transfer an archived code from their own store", async () => {
    const { caller, org, managerUser, source, input } = await setup();
    await caller.products.archive({ productId: source.id });
    const manager = createTestCaller({ ...managerUser, organizationId: org.id });
    expect(
      (await manager.products.duplicateDiagnostics({ barcodes: input.barcodes }))
        .exactBarcodeMatches[0],
    ).toMatchObject({ canAccess: true, canTransfer: true });
    const target = await manager.products.create(input);
    expect((await manager.products.lookupScan({ q: input.barcodes[0] })).items[0].id).toBe(
      target.id,
    );
  });

  it("transfers on edit, preserves other target codes and tolerates retry after success", async () => {
    const { caller, source, input, product, baseUnit } = await setup();
    await caller.products.archive({ productId: source.id });
    const update = {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      baseUnitId: baseUnit.id,
      barcodes: [...input.barcodes, "TARGET-OWN-CODE"],
      barcodeTransfers: input.barcodeTransfers,
    };
    await caller.products.update(update);
    await caller.products.restore({ productId: source.id });
    await caller.products.update(update);
    expect(
      (await prisma.productBarcode.findMany({ where: { productId: product.id } }))
        .map((b) => b.value)
        .sort(),
    ).toEqual([...update.barcodes].sort());
    expect(await prisma.auditLog.count({ where: { action: "PRODUCT_BARCODE_TRANSFER" } })).toBe(1);
  });

  it("rejects transfer of a barcode absent from the submitted receiving product", async () => {
    const { caller, source, input } = await setup();
    await caller.products.archive({ productId: source.id });
    await expect(
      caller.products.create({ ...input, barcodes: ["DIFFERENT-CODE"] }),
    ).rejects.toMatchObject({ message: "invalidInput" });
    expect(await prisma.productBarcode.count({ where: { productId: source.id } })).toBe(2);
  });
});

import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { productsRouter } from "@/server/trpc/routers/products";
import {
  cleanupCommerceFixtures,
  commerceContext,
  createCommerceFixtures,
  type CommerceFixtures,
} from "./fixtures";

// The import dependency is blocked before loading the narrow products router;
// its implementation includes excluded workflows. The global setup separately
// blocks applyStockMovement. No appRouter or excluded operation is invoked.
vi.mock("@/server/services/imports", () => ({
  runProductImport: () => {
    throw new Error("Product imports are outside this metadata test");
  },
}));

describe("persisted product metadata without stock operations", () => {
  let fixture: CommerceFixtures;
  let unitId: string;
  let guardActive = false;
  let blockedWrites: string[] = [];
  let emptyBoundaryCalls = 0;

  beforeAll(() => {
    guardActive = true;
    prisma.$use(async (params, next) => {
      if (
        guardActive &&
        ["StockMovement", "InventorySnapshot", "ReorderPolicy"].includes(params.model ?? "") &&
        /^(create|update|delete|upsert)/.test(params.action)
      ) {
        // An empty createMany is an explicit no-op boundary, never sent to SQL.
        if (
          params.action === "createMany" &&
          Array.isArray(params.args?.data) &&
          params.args.data.length === 0
        ) {
          emptyBoundaryCalls += 1;
          return { count: 0 };
        }
        blockedWrites.push(`${params.model}.${params.action}`);
        throw new Error("Excluded stock write attempted by a product metadata test");
      }
      if (
        guardActive &&
        /executeRaw/.test(params.action) &&
        /(?:StockMovement|InventorySnapshot|ReorderPolicy)/.test(JSON.stringify(params.args))
      ) {
        blockedWrites.push("raw excluded-model write");
        throw new Error("Excluded raw stock write attempted by a product metadata test");
      }
      return next(params);
    });
  });

  beforeEach(async () => {
    blockedWrites = [];
    emptyBoundaryCalls = 0;
    fixture = await createCommerceFixtures(prisma);
    unitId = (
      await prisma.unit.create({
        data: {
          organizationId: fixture.tenants.a.org.id,
          code: "TEST_UNIT",
          labelRu: "Тест",
          labelKg: "Тест",
        },
      })
    ).id;
  });

  afterEach(async () => {
    try {
      expect(blockedWrites).toEqual([]);
      // The two-store/no-storeId path currently avoids even an empty write.
      expect(emptyBoundaryCalls).toBe(0);
    } finally {
      if (fixture) {
        const where = {
          organizationId: { in: [fixture.tenants.a.org.id, fixture.tenants.b.org.id] },
        };
        await prisma.productEvent.deleteMany({ where });
        await prisma.operationRequest.deleteMany({ where });
        await prisma.product.deleteMany({ where });
        await prisma.unit.deleteMany({ where });
        await cleanupCommerceFixtures(prisma, fixture);
      }
    }
  });
  afterAll(() => {
    guardActive = false;
  });

  const caller = (role: Role = Role.ADMIN, tenant: "a" | "b" = "a") =>
    productsRouter.createCaller(commerceContext(prisma, fixture.tenants[tenant].users[role]));
  const input = () => ({
    idempotencyKey: randomUUID(),
    sku: `META-${randomUUID()}`,
    name: "Synthetic metadata product",
    baseUnitId: unitId,
    basePriceKgs: 125.5,
    description: "Metadata only: no stock, cost, store assignment, image or variant inputs",
  });
  const updateInput = (product: { id: string; sku: string; name: string }) => ({
    productId: product.id,
    sku: product.sku,
    name: product.name,
    baseUnitId: unitId,
    basePriceKgs: 125.5,
  });
  const productCount = () =>
    prisma.product.count({ where: { organizationId: fixture.tenants.a.org.id } });

  test("admin create/update/archive/restore persists across fresh detail callers", async () => {
    const created = await caller().create(input());
    expect(await caller().getById({ productId: created.id })).toMatchObject({
      id: created.id,
      name: created.name,
      basePriceKgs: 125.5,
    });
    const changed = {
      ...updateInput(created),
      name: "Updated synthetic metadata",
      basePriceKgs: 88.75,
    };
    await caller().update(changed);
    expect(await caller().getById({ productId: created.id })).toMatchObject({
      id: created.id,
      name: changed.name,
      basePriceKgs: 88.75,
    });
    await caller().archive({ productId: created.id });
    expect(await caller().getById({ productId: created.id })).toBeNull();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).isDeleted).toBe(
      true,
    );
    await caller().restore({ productId: created.id });
    expect(await caller().getById({ productId: created.id })).toMatchObject({
      id: created.id,
      name: changed.name,
      basePriceKgs: 88.75,
      isDeleted: false,
    });
    expect(
      await prisma.auditLog.findMany({
        where: { entityId: created.id },
        select: { action: true },
        orderBy: { createdAt: "asc" },
      }),
    ).toEqual([
      { action: "PRODUCT_CREATE" },
      { action: "PRODUCT_UPDATE" },
      { action: "PRODUCT_ARCHIVE" },
      { action: "PRODUCT_RESTORE" },
    ]);
  });

  test("duplicate create idempotency replays one product and rejects changed payload", async () => {
    const request = input();
    const first = await caller().create(request);
    const replay = await caller().create(request);
    expect(replay.id).toBe(first.id);
    expect(await productCount()).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { entityId: first.id, action: "PRODUCT_CREATE" } }),
    ).toBe(1);
    await expect(
      caller().create({ ...request, name: "Changed replay payload" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await productCount()).toBe(1);
    expect((await caller().getById({ productId: first.id }))?.name).toBe(request.name);
  });

  test("invalid create and conflicting update leave persisted metadata unchanged", async () => {
    await expect(caller().create({ ...input(), name: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller().create({ ...input(), baseUnitId: "missing-unit" })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(await productCount()).toBe(0);
    const first = await caller().create(input());
    const second = await caller().create(input());
    const before = await prisma.product.findUniqueOrThrow({ where: { id: second.id } });
    const auditBefore = await prisma.auditLog.count({ where: { entityId: second.id } });
    await expect(
      caller().update({
        ...updateInput(second),
        sku: first.sku,
        name: "Must roll back",
        basePriceKgs: 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: second.id } })).toEqual(before);
    expect(await prisma.auditLog.count({ where: { entityId: second.id } })).toBe(auditBefore);
    expect(await productCount()).toBe(2);
  });

  test("another organization cannot read or mutate a product by its identifier", async () => {
    const created = await caller().create(input());
    const foreign = caller(Role.ADMIN, "b");
    expect(await foreign.getById({ productId: created.id })).toBeNull();
    await expect(foreign.update(updateInput(created))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(foreign.archive({ productId: created.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(foreign.restore({ productId: created.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await caller().getById({ productId: created.id })).toMatchObject({
      id: created.id,
      isDeleted: false,
    });
  });

  test.each([Role.STAFF, Role.CASHIER])(
    "%s cannot create, update, archive or restore product metadata",
    async (role) => {
      const created = await caller().create(input());
      const restricted = caller(role);
      await expect(restricted.create(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(restricted.update(updateInput(created))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(restricted.archive({ productId: created.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await caller().archive({ productId: created.id });
      await expect(restricted.restore({ productId: created.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).isDeleted,
      ).toBe(true);
      expect(await productCount()).toBe(1);
    },
  );
});

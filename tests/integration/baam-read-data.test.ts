import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { baamSearch } from "@/server/services/baamReadTools";
import { readBaamData } from "@/server/services/baamReadData";
import { businessCaller } from "@/server/services/baamBusiness";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { readRequest } from "../helpers/baamReadProvider";
const context = (u: User) => ({
  prisma,
  user: { ...u, organizationId: u.organizationId!, isPlatformOwner: false },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("baam-read-data"),
});
describe.skipIf(!shouldRunDbTests)("Baam business read semantics", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE" });
    return { ...f, ctx: context(f.adminUser), manager: context(f.managerUser) };
  }
  it("selects the latest COMPLETED nonheld POS sale by completion date, excluding drafts, held and ordinary orders", async () => {
    const f = await fixture();
    const make = (data: object) =>
      prisma.customerOrder.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          number: randomUUID(),
          isPosSale: true,
          totalKgs: 100,
          ...data,
        },
      });
    const latest = await make({
      status: "COMPLETED",
      createdAt: new Date("2026-01-01"),
      completedAt: new Date("2026-10-22T10:00:00Z"),
    });
    await make({
      status: "COMPLETED",
      createdAt: new Date("2026-10-23"),
      completedAt: new Date("2026-10-22T09:00:00Z"),
    });
    await make({ status: "DRAFT", isHeld: true, createdAt: new Date("2026-10-24") });
    await make({ status: "DRAFT", isHeld: true, totalKgs: 250, createdAt: new Date("2026-10-25") });
    await make({ status: "COMPLETED", isHeld: true, completedAt: new Date("2026-10-24") });
    await make({ status: "COMPLETED", isPosSale: false, completedAt: new Date("2026-10-25") });
    const read = await readBaamData(f.ctx, readRequest({ dataset: "sales", mode: "latest" }), "en");
    expect(read.records.map((r) => r.id)).toEqual([latest.id]);
    expect(read.facts[0].value).toBe("2");
    expect(read.facts.some((f) => /TOTAL amount/.test(f.label))).toBe(false);
    expect(read.records[0].displayFields.some((f) => f.value.includes("100 KGS"))).toBe(true);
    const drafts = await readBaamData(
      f.ctx,
      readRequest({ dataset: "sales", mode: "drafts" }),
      "ru",
    );
    expect(drafts.records).toHaveLength(2);
    expect(drafts.facts.find((f) => f.label.includes("Общая сумма"))?.value).toBe("350 KGS");
    expect(drafts.records[0].displayFields.some((f) => f.value.includes("Не оплачен"))).toBe(true);
  });
  it("filters new customers by Bishkek business dates and sorts newest first, omitting contacts by default", async () => {
    const f = await fixture();
    for (const [name, createdAt] of [
      ["Before", "2026-10-21T17:59:59Z"],
      ["First", "2026-10-21T18:00:00Z"],
      ["Newest", "2026-10-22T17:59:59Z"],
      ["After", "2026-10-22T18:00:00Z"],
    ]) {
      await prisma.customer.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          name,
          phone: "+996555000001",
          email: "fixture@example.invalid",
          createdAt: new Date(createdAt),
        },
      });
    }
    const read = await readBaamData(
      f.ctx,
      readRequest({
        dataset: "customers",
        mode: "new",
        dateFrom: "2026-10-22",
        dateTo: "2026-10-22",
      }),
      "ru",
    );
    expect(read.records.map((r) => r.title)).toEqual(["Newest", "First"]);
    expect(read.facts[0].value).toBe("2");
    expect(JSON.stringify(read)).not.toContain("+996555000001");
    expect(JSON.stringify(read)).not.toContain("fixture@example.invalid");
    const details = await readBaamData(
      f.ctx,
      readRequest({ dataset: "customers", mode: "details", query: "Newest" }),
      "ru",
    );
    expect(JSON.stringify(details.records)).toContain("fixture@example.invalid");
    expect(read.records[0].displayFields[0].value).toContain("22");
  });
  it("reads an entire posted receiving document, grouping its product lines and linking to the real document", async () => {
    const f = await fixture(),
      api = businessCaller(f.ctx);
    const second = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: "Second",
        sku: "SECOND",
        unit: "each",
        baseUnitId: f.baseUnit.id,
        storeProducts: { create: { organizationId: f.org.id, storeId: f.store.id } },
      },
    });
    await api.inventory.receive({
      storeId: f.store.id,
      productId: f.product.id,
      qtyReceived: 3,
      unitCost: 0,
      idempotencyKey: randomUUID(),
    });
    const receivingId = randomUUID();
    await prisma.stockMovement.createMany({
      data: [f.product, second].map((p) => ({
        storeId: f.store.id,
        productId: p.id,
        type: "RECEIVE" as const,
        qtyDelta: 5,
        unitCostKgs: 10,
        lineTotalKgs: 50,
        referenceType: "STOCK_RECEIVING",
        referenceId: receivingId,
        createdAt: new Date(Date.now() + 1000),
      })),
    });
    const read = await readBaamData(
      f.ctx,
      readRequest({ dataset: "stock_movements", mode: "latest", movementType: "RECEIVE" }),
      "ru",
    );
    expect(read.records).toHaveLength(1);
    expect(read.records[0].href).toMatch(/^\/inventory\/movements\//);
    expect(JSON.stringify(read.records[0])).toContain("Second");
    expect(JSON.stringify(read.records[0])).toContain("Test Product");
    expect(read.facts[0].value).toBe("2");
  });
  it("resolves a spoken SKU against the authorized catalog beyond recent ASR hints and preserves ambiguity", async () => {
    const f = await fixture();
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: 7 },
    });
    const found = (await baamSearch(f.manager, {
      kind: "products",
      query: "тест один",
      offset: 0,
    })) as { items: Array<{ id: string }> };
    expect(found.items.map((p) => p.id)).toEqual([f.product.id]);
    expect(
      (
        await readBaamData(
          f.manager,
          readRequest({ dataset: "products", mode: "list", query: "тест один" }),
          "ru",
        )
      ).records[0].id,
    ).toBe(f.product.id);
    const stock = await readBaamData(
      f.manager,
      readRequest({ dataset: "inventory", mode: "list", query: "тест один" }),
      "en",
    );
    expect(stock.records).toHaveLength(1);
    expect(stock.records[0].href).toBe("/products/" + f.product.id);
    expect(stock.records[0].displayFields[0].value).toBe("7 each");
    const second = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "TEST-01",
        name: "Another identifier",
        unit: "each",
        baseUnitId: f.baseUnit.id,
        storeProducts: { create: { organizationId: f.org.id, storeId: f.store.id } },
      },
    });
    const ambiguous = (await baamSearch(f.manager, {
      kind: "products",
      query: "тест один",
      offset: 0,
    })) as { items: Array<{ id: string }> };
    expect(new Set(ambiguous.items.map((p) => p.id))).toEqual(new Set([f.product.id, second.id]));
    expect(
      await readBaamData(
        f.manager,
        readRequest({ dataset: "inventory", mode: "list", query: "тест один" }),
        "en",
      ),
    ).toMatchObject({
      needsSelection: true,
      records: [{ displayFields: [] }, { displayFields: [] }],
    });
    const hidden = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Hidden alias", code: "HA" },
    });
    const privateProduct = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "HIDDEN-1",
        name: "Private",
        unit: "each",
        baseUnitId: f.baseUnit.id,
        storeProducts: { create: { organizationId: f.org.id, storeId: hidden.id } },
      },
    });
    const denied = (await baamSearch(f.manager, {
      kind: "products",
      query: "хидден один",
      offset: 0,
    })) as { items: Array<{ id: string }> };
    expect(denied.items.some((p) => p.id === privateProduct.id)).toBe(false);
  });
  it("supports an explicit all-accessible scope even when the conversation selects one store", async () => {
    const f = await fixture();
    const second = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Second", code: "SECOND" },
    });
    for (const storeId of [f.store.id, second.id])
      await prisma.customer.create({ data: { organizationId: f.org.id, storeId, name: storeId } });
    expect(
      (
        await readBaamData(
          f.ctx,
          readRequest({ dataset: "customers", mode: "list", store: "*" }),
          "en",
          f.store.id,
        )
      ).records,
    ).toHaveLength(2);
    expect(
      (
        await readBaamData(
          f.manager,
          readRequest({ dataset: "customers", mode: "list", store: "*" }),
          "en",
          f.store.id,
        )
      ).records,
    ).toHaveLength(1);
  });
  it("enforces store grants and hides both rows and counts from inaccessible stores", async () => {
    const f = await fixture();
    const hidden = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Hidden", code: "H" },
    });
    await prisma.customer.create({
      data: { organizationId: f.org.id, storeId: hidden.id, name: "Secret customer" },
    });
    const read = await readBaamData(
      f.manager,
      readRequest({ dataset: "customers", mode: "list" }),
      "en",
    );
    expect(read.records).toEqual([]);
    expect(read.facts[0].value).toBe("0");
    await expect(
      readBaamData(f.manager, readRequest({ dataset: "customers", store: "Hidden" }), "en"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      readBaamData(f.manager, readRequest({ dataset: "inventory" }), "en", hidden.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["STAFF", "CASHIER"] as const)("doesn't expose business reads to %s", async (role) => {
    const f = await fixture();
    const user = role === "STAFF" ? f.staffUser : f.cashierUser;
    await expect(
      readBaamData(context(user), readRequest({ dataset: "sales" }), "en"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not grant analytics or POS through the new reader on a locked plan", async () => {
    const f = await fixture();
    await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "STARTER" } });
    await expect(
      readBaamData(f.ctx, readRequest({ dataset: "sales_metrics" }), "en"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (
        await readBaamData(
          f.ctx,
          readRequest({ dataset: "products", mode: "list", query: "TEST-1" }),
          "en",
        )
      ).records,
    ).toHaveLength(1);
  });
  it("applies negative/zero/explicit threshold filters to current snapshots and preserves units/store", async () => {
    const f = await fixture();
    await prisma.inventorySnapshot.create({
      data: { storeId: f.store.id, productId: f.product.id, onHand: -2, allowNegativeStock: true },
    });
    for (const mode of ["negative_stock", "low_stock"] as const) {
      const read = await readBaamData(
        f.ctx,
        readRequest({ dataset: "inventory", mode, stockThreshold: 3 }),
        "en",
      );
      expect(read.records).toHaveLength(1);
      expect(JSON.stringify(read.records)).toContain("-2 each");
    }
    expect(
      (await readBaamData(f.ctx, readRequest({ dataset: "inventory", mode: "empty_stock" }), "en"))
        .records,
    ).toHaveLength(0);
  });
});

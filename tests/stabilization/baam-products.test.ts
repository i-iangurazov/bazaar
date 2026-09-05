import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { executeBaamProductPlan } from "@/server/services/baamProducts";
import type { BaamProductPlan } from "@/server/services/baamProductPlan";
import { cleanupCommerceFixtures, createCommerceFixtures, type CommerceFixtures } from "./fixtures";

// Actual SQL and database-backed role/grant checks. Product/report rows exist
// only in this connection's TEMP projection; no operational producer or live
// Product/StoreProduct/sales/returns/stock row is written. The service itself
// sets its transaction READ ONLY after this synthetic setup.
describe("BAAM products on a temporary read-only reporting projection", () => {
  let fixture: CommerceFixtures;
  beforeEach(async () => { fixture = await createCommerceFixtures(prisma); });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (fixture) await cleanupCommerceFixtures(prisma, fixture);
  });

  const plan = (values: Partial<BaamProductPlan> = {}): BaamProductPlan => ({ intent: "products", productAction: "ranking", query: null, direction: "top", metric: "revenue", limit: 10, ...values });
  const request = (values: Partial<BaamProductPlan> = {}) => ({ actorId: fixture.tenants.a.users.MANAGER.id, range: { dateFrom: "2026-09-01", dateTo: "2026-09-02" }, locale: "en" as const, plan: plan(values) });

  async function projection(extra?: (tx: Prisma.TransactionClient) => Promise<void>) {
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
      return original(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL search_path TO pg_temp, public");
        for (const ddl of [
          `CREATE TEMP TABLE "Product" (id text PRIMARY KEY, "organizationId" text, name text, sku text, unit text DEFAULT 'pcs', category text, categories text[] DEFAULT '{}', "basePriceKgs" numeric DEFAULT 100, "isDeleted" boolean DEFAULT false) ON COMMIT DROP`,
          `CREATE TEMP TABLE "StoreProduct" ("productId" text, "organizationId" text, "storeId" text, "isActive" boolean DEFAULT true) ON COMMIT DROP`,
          `CREATE TEMP TABLE "ProductBarcode" (id text, "productId" text, "organizationId" text, value text, "createdAt" timestamp DEFAULT now()) ON COMMIT DROP`,
          `CREATE TEMP TABLE "CustomerOrder" (id text PRIMARY KEY, "organizationId" text, "storeId" text, "isPosSale" boolean DEFAULT true, "isHeld" boolean DEFAULT false, status text DEFAULT 'COMPLETED', "completedAt" timestamp) ON COMMIT DROP`,
          `CREATE TEMP TABLE "CustomerOrderLine" ("productId" text, "customerOrderId" text, qty int, "lineTotalKgs" numeric) ON COMMIT DROP`,
          `CREATE TEMP TABLE "SaleReturn" (id text PRIMARY KEY, "organizationId" text, "storeId" text, status text DEFAULT 'COMPLETED', "completedAt" timestamp) ON COMMIT DROP`,
          `CREATE TEMP TABLE "SaleReturnLine" ("productId" text, "saleReturnId" text, qty int, "lineTotalKgs" numeric) ON COMMIT DROP`,
        ]) await tx.$executeRawUnsafe(ddl);
        const { a, b } = fixture.tenants;
        for (const [id, org, store] of [
          ["a", a.org.id, a.stores[0].id], ["b", a.org.id, a.stores[0].id],
          ["zero", a.org.id, a.stores[0].id], ["return-only", a.org.id, a.stores[0].id],
          ["archived", a.org.id, a.stores[0].id], ["inactive", a.org.id, a.stores[0].id],
          ["unassigned", a.org.id, null], ["hidden", a.org.id, a.stores[1].id],
          ["foreign", b.org.id, b.stores[0].id],
        ]) {
          await tx.$executeRaw`INSERT INTO "Product" (id,"organizationId",name,sku,"isDeleted") VALUES (${id},${org},${id},${"SKU-" + id},${id === "archived"})`;
          if (store) await tx.$executeRaw`INSERT INTO "StoreProduct" ("productId","organizationId","storeId","isActive") VALUES (${id},${org},${store},${id !== "inactive"})`;
        }
        // A second assignment must not duplicate a product's sale totals.
        await tx.$executeRaw`INSERT INTO "StoreProduct" ("productId","organizationId","storeId") VALUES ('a',${a.org.id},${a.stores[1].id})`;
        await tx.$executeRaw`INSERT INTO "ProductBarcode" (id,"productId","organizationId",value) VALUES ('barcode-a','a',${a.org.id},'123456')`;
        await sale(tx, { id: "sale-a", product: "a", qty: 3, revenue: 150 });
        await sale(tx, { id: "variant-a", product: "a", qty: 2, revenue: 100 });
        await sale(tx, { id: "sale-b", product: "b", qty: 8, revenue: 160 });
        await returned(tx, "return-a", "a", 1, 50);
        await returned(tx, "return-prior", "return-only", 2, 70);
        if (extra) await extra(tx);
        const result = await callback(tx);
        const [settings] = await tx.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
        expect(settings.transaction_read_only).toBe("on");
        return result;
      }, options);
    }) as typeof prisma.$transaction);
  }
  async function sale(tx: Prisma.TransactionClient, value: { id: string; product: string; qty?: number; revenue?: number; date?: string; org?: string; store?: string; held?: boolean; pos?: boolean; status?: string }) {
    const { a } = fixture.tenants;
    await tx.$executeRaw`INSERT INTO "CustomerOrder" (id,"organizationId","storeId","isHeld","isPosSale",status,"completedAt")
      VALUES (${value.id},${value.org ?? a.org.id},${value.store ?? a.stores[0].id},${value.held ?? false},${value.pos ?? true},${value.status ?? "COMPLETED"},${new Date(value.date ?? "2026-09-01T08:00:00Z")})`;
    await tx.$executeRaw`INSERT INTO "CustomerOrderLine" ("productId","customerOrderId",qty,"lineTotalKgs") VALUES (${value.product},${value.id},${value.qty ?? 100},${value.revenue ?? 99999})`;
  }
  async function returned(tx: Prisma.TransactionClient, id: string, product: string, qty: number, revenue: number) {
    const { a } = fixture.tenants;
    await tx.$executeRaw`INSERT INTO "SaleReturn" (id,"organizationId","storeId","completedAt") VALUES (${id},${a.org.id},${a.stores[0].id},${new Date("2026-09-02T10:00:00Z")})`;
    await tx.$executeRaw`INSERT INTO "SaleReturnLine" ("productId","saleReturnId",qty,"lineTotalKgs") VALUES (${product},${id},${qty},${revenue})`;
  }
  const field = (card: { displayFields: Array<{ label: string; value: string }> }, label: string) => card.displayFields.find(value => value.label === label)?.value;

  it("ranks product-level net line revenue with returns, stable ties, zeroes and no assignment duplication", async () => {
    await projection();
    const result = await executeBaamProductPlan({ ...request(), actorId: fixture.tenants.a.users.ADMIN.id });
    expect(result.cards.map(card => card.id)).toEqual(["a", "b", "hidden", "zero", "return-only"]);
    expect(field(result.cards[0], "Net line revenue")).toBe("200 KGS");
    expect(field(result.cards[0], "Net quantity")).toBe("4 pcs");
    expect(result.evidence.details.join(" ")).toContain("Products in this population: 5");
  });
  it("uses actual manager assignments and supports ascending net units including return-only negatives", async () => {
    await projection();
    const result = await executeBaamProductPlan(request({ direction: "bottom", metric: "units" }));
    expect(result.cards.map(card => card.id)).toEqual(["return-only", "zero", "a", "b"]);
    expect(field(result.cards[0], "Net quantity")).toBe("-2 pcs");
    expect(result.evidence.details.join(" ")).not.toContain(fixture.tenants.a.stores[1].name);
  });
  it("distinguishes no qualifying sales from return-only activity", async () => {
    await projection();
    const result = await executeBaamProductPlan(request({ productAction: "zero_sales", direction: null, metric: null }));
    expect(result.cards.map(card => card.id)).toEqual(["return-only", "zero"]);
    expect(field(result.cards[0], "Sold quantity")).toBe("0 pcs");
    expect(field(result.cards[0], "Returned quantity")).toBe("2 pcs");
  });
  it("excludes foreign/store/channel/held/draft/outside-date lines before ranking and honors business midnight", async () => {
    await projection(async tx => {
      const { a, b } = fixture.tenants;
      for (const values of [
        { org: b.org.id }, { store: a.stores[1].id }, { pos: false }, { held: true }, { status: "DRAFT" },
        { date: "2026-08-31T17:59:59.999Z" }, { date: "2026-09-02T18:00:00Z" },
      ]) await sale(tx, { ...values, id: randomUUID(), product: "a" });
      await sale(tx, { id: "midnight-start", product: "a", qty: 1, revenue: 10, date: "2026-08-31T18:00:00Z" });
      await sale(tx, { id: "midnight-end", product: "a", qty: 1, revenue: 10, date: "2026-09-02T17:59:59.999Z" });
    });
    const result = await executeBaamProductPlan(request());
    expect(field(result.cards[0], "Net line revenue")).toBe("220 KGS");
  });
  it("finds exact SKU/barcode and treats wildcard punctuation literally without broadening", async () => {
    await projection();
    const result = await executeBaamProductPlan(request({ productAction: "search", direction: null, metric: null, query: "123456" }));
    expect(result.cards.map(card => card.id)).toEqual(["a"]);
    expect(result.contextProductId).toBe("a");
    expect(result.evidence.appliedPeriod).toBe(false);
    const none = await executeBaamProductPlan(request({ productAction: "search", direction: null, metric: null, query: "%" }));
    expect(none.cards).toEqual([]);
  });
  it("returns only the selected product's dated sales and returns, retaining return-only negatives", async () => {
    await projection();
    const selected = await executeBaamProductPlan({ ...request({ productAction: "performance", direction: null, metric: null }), pageProductId: "a" });
    expect(selected.cards.map(card => card.id)).toEqual(["a"]);
    expect(field(selected.cards[0], "Net line revenue")).toBe("200 KGS");
    expect(field(selected.cards[0], "Sold quantity")).toBe("5 pcs");
    expect(field(selected.cards[0], "Returned quantity")).toBe("1 pcs");
    expect(selected.contextProductId).toBe("a");
    expect(selected.evidence.appliedPeriod).toBe(true);
    const returnedOnly = await executeBaamProductPlan(request({ productAction: "performance", direction: null, metric: null, query: "SKU-return-only" }));
    expect(returnedOnly.cards.map(card => card.id)).toEqual(["return-only"]);
    expect(field(returnedOnly.cards[0], "Net line revenue")).toBe("-70 KGS");
    expect(field(returnedOnly.cards[0], "Sold quantity")).toBe("0 pcs");
  });
  it("clarifies absent/ambiguous performance references and rejects ungranted product pages", async () => {
    await projection();
    const values = { productAction: "performance" as const, direction: null, metric: null };
    expect((await executeBaamProductPlan(request(values))).status).toBe("clarification");
    const choices = await executeBaamProductPlan(request({ ...values, query: "SKU-", limit: 1 }));
    expect(choices.status).toBe("clarification");
    expect(choices.contextProductId).toBeUndefined();
    await expect(executeBaamProductPlan({ ...request(values), pageProductId: "hidden" })).rejects.toThrow("productAccessDenied");
    await expect(executeBaamProductPlan({ ...request(values), pageProductId: "foreign" })).rejects.toThrow("productAccessDenied");
  });
  it("checks product-page references against current organization, assignment and archive state", async () => {
    await projection();
    for (const pageProductId of ["foreign", "hidden", "archived", "inactive", "unassigned", "missing"]) {
      await expect(executeBaamProductPlan({ ...request({ productAction: "details", direction: null, metric: null }), pageProductId })).rejects.toThrow("productAccessDenied");
    }
    const result = await executeBaamProductPlan({ ...request({ productAction: "details", direction: null, metric: null }), pageProductId: "a" });
    expect(result.cards[0].href).toBe("/products/a");
  });
  it("denies actual unauthorized roles and foreign stores, then honors a revoked grant", async () => {
    const { a, b } = fixture.tenants;
    await projection();
    for (const role of ["STAFF", "CASHIER"] as const) await expect(executeBaamProductPlan({ ...request(), actorId: a.users[role].id })).rejects.toThrow("forbidden");
    await expect(executeBaamProductPlan({ ...request(), storeId: b.stores[0].id })).rejects.toThrow("storeAccessDenied");
    await prisma.userStoreAccess.deleteMany({ where: { userId: a.users.MANAGER.id, organizationId: a.org.id } });
    expect((await executeBaamProductPlan(request())).cards).toEqual([]);
  });
});

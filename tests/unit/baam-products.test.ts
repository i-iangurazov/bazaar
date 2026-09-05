import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), readScope: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/server/db/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/server/services/baamMetrics", () => ({ readBaamAccessScope: mocks.readScope }));
import { parseLocalBaamProductPlan, productPlanSchema, type BaamProductPlan } from "@/server/services/baamProductPlan";
import { executeBaamProductPlan } from "@/server/services/baamProducts";
import { baamProductFollowUps } from "@/server/services/baamFollowUps";

const plan = (values: Partial<BaamProductPlan> = {}): BaamProductPlan => ({ intent: "products", productAction: "search", query: null, direction: null, metric: null, limit: 5, ...values });
const input = (values: Partial<BaamProductPlan> = {}) => ({ actorId: "actor-a", range: { dateFrom: "2026-09-01", dateTo: "2026-09-02" }, locale: "en" as const, plan: plan(values) });
const row = (values: Record<string, unknown> = {}) => ({ id: "product-a", name: "Tea", sku: "TEA-01", unit: "pcs", category: "Drinks", barcode: "123", basePriceKgs: new Prisma.Decimal(100), quantitySold: new Prisma.Decimal(5), quantityReturned: new Prisma.Decimal(1), netQuantity: new Prisma.Decimal(4), netRevenueKgs: new Prisma.Decimal(90), total: 1, population: 4, ...values });

describe("local BAAM product plans", () => {
  it.each([
    ["Show top 3 products", "ranking", "top", "revenue"],
    ["Lowest selling products by revenue", "ranking", "bottom", "revenue"],
    ["Самые популярные товары", "ranking", "top", "revenue"],
    ["Какие товары продаются хуже", "ranking", "bottom", "revenue"],
    ["Эң көп сатылган товарлар", "ranking", "top", "revenue"],
    ["Эң аз сатылган товарлар", "ranking", "bottom", "revenue"],
    ["Top products by quantity", "ranking", "top", "units"],
    ["Products with no sales", "zero_sales", null, null],
    ["Товары без продаж", "zero_sales", null, null],
    ["Сатылбаган товарлар", "zero_sales", null, null],
  ])("recognizes bounded local request %s", (question, productAction, direction, metric) => {
    expect(parseLocalBaamProductPlan(question)).toMatchObject({ productAction, direction, metric });
  });
  it.each(["Find product ABC123", "Найди товар ABC123", "Товарды тап ABC123"])("preserves literal SKU in %s", question => {
    expect(parseLocalBaamProductPlan(question)).toMatchObject({ query: "ABC123", productAction: "search" });
  });
  it.each([en, ru, kg])("recognizes every actual localized product starter", messages => {
    const labels = messages.baam.assistant;
    expect(parseLocalBaamProductPlan(labels.topProductsPrompt)).toMatchObject({ productAction: "ranking", direction: "top", metric: "revenue" });
    expect(parseLocalBaamProductPlan(labels.bottomProductsPrompt)).toMatchObject({ productAction: "ranking", direction: "bottom", metric: "revenue" });
    expect(parseLocalBaamProductPlan(labels.zeroProductsPrompt)).toMatchObject({ productAction: "zero_sales" });
    expect(parseLocalBaamProductPlan(labels.productDetailsPrompt, "product-a")).toMatchObject({ productAction: "details" });
  });
  it("recognizes same-page details without placing the reference in a plan", () => {
    const result = parseLocalBaamProductPlan("Tell me about this product", "server-validated-later");
    expect(result).toMatchObject({ productAction: "details", query: null });
    expect(JSON.stringify(result)).not.toContain("server-validated-later");
    expect(parseLocalBaamProductPlan("Tell me about this product")).toBeNull();
  });
  it.each([
    "How much did it sell?", "What are its returns?", "How many units did it sell?",
    "А сколько его продали?", "Какие у него возвраты?",
    "Бул товардан канча сатылды?", "Анын кайтаруулары кандай?", "Анын кайтаруулары канча?",
  ])("recognizes single-period product performance only with a product reference: %s", question => {
    expect(parseLocalBaamProductPlan(question, "product-a")).toMatchObject({ productAction: "performance", query: null, direction: null, metric: null });
    expect(parseLocalBaamProductPlan(question)).toBeNull();
  });
  it("does not reduce a cross-period product comparison to single-period performance", () => {
    expect(parseLocalBaamProductPlan("How much did it sell compared with last month?", "product-a")).toBeNull();
  });
  it.each(["en", "ru", "kg"] as const)("recognizes both emitted performance follow-ups in %s", locale => {
    for (const question of baamProductFollowUps(locale, true).slice(0, 2)) {
      expect(parseLocalBaamProductPlan(question, "product-a")).toMatchObject({ productAction: "performance" });
    }
  });
  it.each(["Why are these products selling badly?", "Delete product Tea", "Прогноз продаж товаров", "Эмне үчүн товарлар сатылбай жатат?", "Products that never sold", "Товары которые никогда не продавались", "Эч качан сатылбаган товарлар"])("does not reinterpret unsupported request %s", question => expect(parseLocalBaamProductPlan(question)).toBeNull());
  it("rejects model supplied URLs/IDs/extra facts and oversized limits", () => {
    expect(productPlanSchema.safeParse({ ...plan(), productId: "foreign", href: "https://evil.test" }).success).toBe(false);
    expect(productPlanSchema.safeParse(plan({ limit: 11 })).success).toBe(false);
    expect(productPlanSchema.safeParse(plan({ query: " " })).success).toBe(false);
  });
});

describe("BAAM product read boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async callback => callback({ $executeRaw: mocks.execute, $queryRaw: mocks.query }));
    mocks.readScope.mockResolvedValue({ organizationId: "org-a", storeIds: ["store-a"], availableStores: [{ id: "store-a", name: "Accessible" }, { id: "store-b", name: "Not selected" }] });
    mocks.query.mockResolvedValue([row()]);
  });
  it("reads current catalog only after fresh access and never includes reporting or inventory tables in that query", async () => {
    const result = await executeBaamProductPlan(input());
    expect(mocks.execute.mock.calls[0][0].join("")).toBe("SET TRANSACTION READ ONLY");
    expect(mocks.readScope).toHaveBeenCalledWith(expect.anything(), "actor-a", undefined);
    expect(mocks.readScope.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0]);
    const sql = mocks.query.mock.calls[0][0] as Prisma.Sql;
    expect(sql.text).not.toMatch(/CustomerOrder|SaleReturn|Inventory|StockMovement/);
    expect(sql.values).toContain("org-a");
    expect(sql.values).toContain("store-a");
    expect(sql.values).not.toContain("store-b");
    expect(result.evidence.appliedPeriod).toBe(false);
    expect(result.evidence.details.join(" ")).toContain("date filter is not applied");
    expect(result.contextProductId).toBe("product-a");
    expect(result.cards[0]).toMatchObject({ href: "/products/product-a", title: "Tea" });
  });
  it("binds wildcard and hostile search text literally without SQL interpolation", async () => {
    const query = "50%_'; DROP TABLE Product; --";
    await executeBaamProductPlan(input({ query }));
    const sql = mocks.query.mock.calls[0][0] as Prisma.Sql;
    expect(sql.text).not.toContain("DROP TABLE");
    expect(sql.values).toContain("%50\\%\\_'; DROP TABLE Product; --%");
    expect(sql.values).toContain(query);
  });
  it("binds exact business-date bounds and reports net metrics including return-only negative values", async () => {
    mocks.query.mockResolvedValue([row({ quantitySold: new Prisma.Decimal(0), quantityReturned: new Prisma.Decimal(2), netQuantity: new Prisma.Decimal(-2), netRevenueKgs: new Prisma.Decimal(-50) })]);
    const result = await executeBaamProductPlan(input({ productAction: "ranking", direction: "bottom", metric: "revenue" }));
    const sql = mocks.query.mock.calls[0][0] as Prisma.Sql;
    expect(sql.values).toContainEqual(new Date("2026-08-31T18:00:00.000Z"));
    expect(sql.values).toContainEqual(new Date("2026-09-02T18:00:00.000Z"));
    expect(sql.text).toContain('"netRevenueKgs"');
    expect(sql.text).not.toMatch(/Inventory|StockMovement/);
    expect(result.evidence.appliedPeriod).toBe(true);
    expect(result.evidence.details.join(" ")).toContain("variants are combined");
    expect(result.cards[0].displayFields[0].value).toBe("-50 KGS");
    expect(result.contextProductId).toBeUndefined();
  });
  it("explains zero-sales limitations and does not equate returns to sales", async () => {
    const result = await executeBaamProductPlan(input({ productAction: "zero_sales" }));
    expect((mocks.query.mock.calls[0][0] as Prisma.Sql).text).toContain("COALESCE(g.sold, 0) = 0");
    expect(result.evidence.details.join(" ")).toContain("returns from earlier sales");
  });
  it("never resolves an ambiguous match from a limit-one response", async () => {
    mocks.query.mockResolvedValue([row({ total: 8 })]);
    const result = await executeBaamProductPlan(input({ productAction: "details", query: "Tea", limit: 1 }));
    expect(result.status).toBe("clarification");
    expect(result.contextProductId).toBeUndefined();
    expect(result.answer).toContain("exact SKU");
  });
  it("requests a reference for details and denies stale or foreign page IDs instead of searching everything", async () => {
    expect((await executeBaamProductPlan(input({ productAction: "details" }))).status).toBe("clarification");
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue([]);
    await expect(executeBaamProductPlan({ ...input({ productAction: "details" }), pageProductId: "foreign-product" })).rejects.toThrow("productAccessDenied");
    expect((mocks.query.mock.calls[0][0] as Prisma.Sql).values).toContain("foreign-product");
  });
  it("applies dated performance to only the validated product reference and retains that reference", async () => {
    const result = await executeBaamProductPlan({ ...input({ productAction: "performance" }), pageProductId: "product-a" });
    const sql = mocks.query.mock.calls[0][0] as Prisma.Sql;
    expect(sql.values).toContain("product-a");
    expect(sql.text).toContain('AND p.id =');
    expect(sql.text).toContain('"CustomerOrderLine"');
    expect(result.evidence.appliedPeriod).toBe(true);
    expect(result.evidence.summary).toBe("Product sales and returns");
    expect(result.contextProductId).toBe("product-a");
    expect(result.cards[0].displayFields.map(field => field.label)).toEqual(["Net line revenue", "Net quantity", "Sold quantity", "Returned quantity"]);
  });
  it("clarifies absent or ambiguous performance references instead of returning the whole catalog", async () => {
    expect((await executeBaamProductPlan(input({ productAction: "performance" }))).status).toBe("clarification");
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue([row({ total: 3 })]);
    const ambiguous = await executeBaamProductPlan(input({ productAction: "performance", query: "Tea", limit: 1 }));
    expect(ambiguous.status).toBe("clarification");
    expect(ambiguous.contextProductId).toBeUndefined();
    expect(ambiguous.answer).toContain("exact SKU");
  });
  it("stops before catalog reads when current role or store access is denied", async () => {
    mocks.readScope.mockRejectedValue(new Error("storeAccessDenied"));
    await expect(executeBaamProductPlan({ ...input(), storeId: "foreign-store" })).rejects.toThrow("storeAccessDenied");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("keeps an empty accessible-store scope empty", async () => {
    mocks.readScope.mockResolvedValue({ organizationId: "org-a", storeIds: [], availableStores: [] });
    mocks.query.mockResolvedValue([]);
    const result = await executeBaamProductPlan(input());
    expect((mocks.query.mock.calls[0][0] as Prisma.Sql).text).toContain("AND false");
    expect(result.cards).toEqual([]);
    expect(result.evidence.details.join(" ")).toContain("No accessible stores");
  });
  it.each(["ru", "kg"] as const)("returns localized fields and source explanations for %s", async locale => {
    const result = await executeBaamProductPlan({ ...input(), locale });
    expect(result.cards[0].displayFields[0].label).not.toBe("Category");
    expect(result.evidence.summary).not.toBe("Current catalog");
  });
  it.each([
    { productAction: "ranking", direction: null, metric: "revenue" },
    { productAction: "ranking", direction: "top", metric: "units", query: "ambiguous filter" },
    { productAction: "search", direction: "top" },
    { productAction: "zero_sales", query: "unsupported narrowing" },
  ] as Partial<BaamProductPlan>[])("rejects ambiguous or contradictory plan before any read: %s", async values => {
    await expect(executeBaamProductPlan(input(values))).rejects.toThrow("invalidInput");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

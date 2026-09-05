import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BAAM_DESTINATION_IDS, BAAM_PAGE_CONTEXTS, getBaamNavigationDestination, matchBaamNavigationIntent, resolveBaamPageContext, suggestBaamDestinations, type BaamNavigationContext } from "@/lib/baamNavigation";

const manager: BaamNavigationContext = {
  access: { role: "MANAGER", isOrgOwner: false },
  planFeatures: ["analytics", "imports", "exports", "stockCounts", "customerOrders", "periodClose"],
  locale: "en",
};
const admin: BaamNavigationContext = { ...manager, planFeatures: [...manager.planFeatures!, "supportToolkit"], access: { role: "ADMIN", isOrgOwner: true, isPlatformOwner: true } };
const ids = (message: string, context = manager) => matchBaamNavigationIntent({ ...context, message }).map(({ id }) => id);

describe("BAAM navigation intent", () => {
  it.each([
    ["open/show me receiving documents", "receiving"],
    ["Show me receiving documents", "receiving"],
    ["Открой документы приёмки", "receiving"],
    ["Открой оприходование", "receiving"],
    ["Кабыл алуу документтерин ачып бер", "receiving"],
    ["Open transfer documents", "transfers"],
    ["Покажи документы списания", "write_offs"],
    ["Эсептен чыгаруу документтерин көрсөт", "write_offs"],
    ["Open stock movement history", "movements"],
    ["Покажи историю движения товаров", "movements"],
    ["Open product categories", "categories"],
    ["Открой категории товаров", "categories"],
    ["Open top products report", "analytics"],
    ["Перейди в аналитику продаж", "analytics"],
    ["Where can I import customers", "imports"],
    ["Открой импорт товаров", "imports"],
    ["Open purchase orders", "purchase_orders"],
    ["Открой заказы поставщикам", "purchase_orders"],
    ["Open order history", "sales_orders"],
    ["Open export history", "exports"],
    ["Кардарларды көрсөт", "customers"],
    ["Open suppliers", "suppliers"],
    ["Products", "products"],
    ["Can you show me my products please", "products"],
    ["I want to see my suppliers", "suppliers"],
    ["Покажите мне товары пожалуйста", "products"],
    ["Хочу посмотреть товары", "products"],
    ["Товарларды ачып берчи", "products"],
    ["Товарларды көргүм келет", "products"],
  ])("%s resolves the intended existing section", (message, expected) => {
    expect(ids(message)[0]).toBe(expected);
  });

  it("can return two explicitly named destinations without making a record or operation", () => {
    expect(ids("open customers and suppliers")).toEqual(["customers", "suppliers"]);
    expect(ids("show receiving documents and transfer documents")).toEqual(["receiving", "transfers"]);
  });

  it.each([
    "Show me top products", "Покажи топ товаров", "How many products were sold today?",
    "Show revenue this month", "Compare receiving totals", "Сколько товаров продано вчера?",
    "Канча товар сатылды?", "Почему упали продажи?", "Tell me about this product",
    "find customer Alice", "open product Milk", "find product P-100", "open supplier 123",
    'find product "Milk"', "Show stock counts for 2026", "Open https://evil.example/reports",
    "javascript:open(reports)", "delete all products", "create a transfer", "Don't open receiving documents",
    "Не открывай документы приёмки", "Эсепте канча товар бар", "",
  ])("leaves analysis, records, and operations to their separate handlers: %s", (message) => {
    expect(ids(message)).toEqual([]);
  });

  it("localizes the label independently from the language used to find it", () => {
    expect(matchBaamNavigationIntent({ ...manager, locale: "ru", message: "open receiving documents" }))
      .toEqual([{ id: "receiving", label: "Оприходование", href: "/inventory/receiving" }]);
    expect(matchBaamNavigationIntent({ ...manager, locale: "kg", message: "open customers" })[0].label).toBe("Кардарлар");
  });
});

describe("BAAM navigation authorization and safe paths", () => {
  it("fails closed for unknown actors, destination IDs, and missing feature entitlements", () => {
    for (const role of [null, "UNKNOWN", "", undefined]) {
      expect(suggestBaamDestinations({ ...admin, access: { role, isOrgOwner: true, isPlatformOwner: true } })).toEqual([]);
    }
    for (const id of ["__proto__", "constructor", "/products/foreign-id", "https://evil.example", "products?storeId=foreign"]) {
      expect(getBaamNavigationDestination(id, admin)).toBeNull();
    }
    expect(ids("open analytics", { ...admin, planFeatures: undefined })).toEqual([]);
    expect(ids("open imports", { ...admin, planFeatures: [] })).toEqual([]);
    expect(ids("open products", { ...admin, planFeatures: [] })).toEqual(["products"]);
  });

  it("combines current role permissions with relevant feature flags", () => {
    expect(getBaamNavigationDestination("users", manager)).toBeNull();
    expect(getBaamNavigationDestination("billing", manager)).toBeNull();
    expect(getBaamNavigationDestination("diagnostics", manager)).toBeNull();
    expect(getBaamNavigationDestination("diagnostics", { ...manager, access: { ...manager.access, isOrgOwner: true } })?.href).toBe("/settings/diagnostics");
    expect(getBaamNavigationDestination("users", admin)?.href).toBe("/settings/users");
    for (const role of ["STAFF", "CASHIER"]) {
      const context = { ...admin, access: { role, isOrgOwner: false } };
      for (const id of ["inventory", "receiving", "transfers", "write_offs", "reports", "analytics", "customers", "suppliers", "imports", "users"]) {
        expect(getBaamNavigationDestination(id, context)).toBeNull();
      }
    }
    expect(getBaamNavigationDestination("stock_counts", { ...manager, planFeatures: ["analytics"] })).toBeNull();
    expect(getBaamNavigationDestination("sales_orders", { ...manager, planFeatures: ["analytics"] })).toBeNull();
    expect(getBaamNavigationDestination("exports", { ...manager, planFeatures: ["analytics"] })).toBeNull();
    expect(getBaamNavigationDestination("period_close", { ...manager, planFeatures: ["analytics"] })).toBeNull();
    expect(getBaamNavigationDestination("support", { ...admin, planFeatures: ["analytics"] })).toBeNull();
    expect(ids("open support toolkit", admin)).toEqual(["support"]);
  });

  it("only returns existing canonical list/settings routes and never dynamic record paths", () => {
    expect(new Set(BAAM_DESTINATION_IDS).size).toBe(BAAM_DESTINATION_IDS.length);
    for (const id of BAAM_DESTINATION_IDS) {
      const action = getBaamNavigationDestination(id, admin);
      expect(action, id).not.toBeNull();
      expect(action!.href).toMatch(/^\/[a-z][a-z0-9/-]*$/);
      expect(action!.href).not.toMatch(/\/new$|\/pos(?:\/|$)|\[|\?|#/);
      // Filesystem route existence only; no operational module is read or imported.
      const roots = ["src/app/(app)", "src/app/(guide)"];
      expect(roots.some((root) => existsSync(resolve(root, `.${action!.href}`, "page.tsx"))), id).toBe(true);
    }
  });
});

describe("BAAM contextual navigation", () => {
  it.each([
    ["/ru/products/actual-id?search=private#details", "products"], ["/kg/inventory/receiving", "inventory"],
    ["/en/settings/import/", "imports"], ["/sales/orders/actual-id", "sales"], ["/reports/analytics", "reports"],
    ["/operations/integrations/email-marketing", "integrations"], ["/products-evil", "unknown"],
    ["https://evil.example/products", "unknown"], ["//evil.example/products", "unknown"], ["/pos", "unknown"],
  ])("reduces pathname %s to a safe section enum", (path, expected) => {
    expect(resolveBaamPageContext(path)).toBe(expected);
    expect(BAAM_PAGE_CONTEXTS).toContain(resolveBaamPageContext(path));
  });

  it("offers useful adjacent routes, prioritizes topic, excludes the current page and denied links", () => {
    expect(suggestBaamDestinations({ ...manager, pathname: "/ru/products" }).map(({ id }) => id))
      .toEqual(["movements", "analytics", "imports", "categories"]);
    expect(suggestBaamDestinations({ ...manager, pathname: "/products", topic: "receiving documents", limit: 2 }).map(({ id }) => id))
      .toEqual(["receiving", "movements"]);
    const limited = suggestBaamDestinations({ ...manager, pathname: "/stores", planFeatures: [], limit: 100 });
    expect(limited.map(({ id }) => id)).toEqual(["inventory"]);
    expect(suggestBaamDestinations({ ...manager, pathname: "/inventory/movements", limit: 6 }).map(({ id }) => id)).not.toContain("movements");
    expect(suggestBaamDestinations({ ...manager, pathname: "/products", limit: 0 })).toEqual([]);
  });
});

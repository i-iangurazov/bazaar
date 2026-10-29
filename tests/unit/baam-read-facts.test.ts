import { describe, expect, it } from "vitest";
import { renderBaamFactAnswer, registerBaamFact } from "@/server/services/baamReadAgent";
import { baamReadPlanSchema, baamReadModelPlanSchema } from "@/server/services/baamReadPlan";
import { isBaamLink, baamUriComponent } from "@/lib/baam/companion";
import { readRequest } from "../helpers/baamReadProvider";
const facts = new Map([
  ["F1", "3 600 KGS"],
  ["F2", "8"],
  ["F3", "AI QA Tea 8"],
  ["F4", "0 pcs"],
]);
const links = new Set([
  "/products/product8",
  "/reports/analytics?dateFrom=2026-10-01&dateTo=2026-10-22",
]);
describe("Baam answer grounding", () => {
  it("provides numeric cells/format variants from server values without making a new calculation", () => {
    const registry = new Map<string, string>();
    const zero = registerBaamFact(registry, "0 KGS");
    expect(zero.numericRef).toBeDefined();
    expect(renderBaamFactAnswer("| Amount KGS |\n|---|\n| 0 |", registry, new Set())).toContain(
      "| 0 |",
    );
    registerBaamFact(registry, "3,600 KGS");
    expect(renderBaamFactAnswer("Revenue 3600 KGS", registry, new Set())).toContain("3600 KGS");
    expect(() => renderBaamFactAnswer("Revenue 3601 KGS", registry, new Set())).toThrow();
    expect(registerBaamFact(registry, "1000 boxes", true).valueKind).toBe("text");
  });
  it("binds authoritative references and exact factual copies without recalculating", () => {
    expect(
      renderBaamFactAnswer("Выручка {{F1}}; найдено 8. [{{F3}}](/products/product8)", facts, links),
    ).toBe("Выручка 3 600 KGS; найдено 8. [AI QA Tea 8](/products/product8)");
  });
  it.each([
    "Выручка 999999 KGS",
    "{{F999}}",
    "{{F1",
    "[Товар](https://evil.example)",
    "[Товар](/admin/users)",
    "[Товар]()",
    "[Товар]({{F3}})",
  ])("rejects fabricated figures, references and destinations: %s", (text) => {
    expect(() => renderBaamFactAnswer(text, facts, links)).toThrow();
  });
  it("allows ordinary list ordinals and date digits inside authorized destinations", () => {
    expect(
      renderBaamFactAnswer(
        "1. Выручка {{F1}}\n2. [Отчёт](/reports/analytics?dateFrom=2026-10-01&dateTo=2026-10-22)",
        facts,
        links,
      ),
    ).toContain("3 600 KGS");
  });
  it("resolves an authorized link reference and canonicalizes encoded document keys", () => {
    expect(renderBaamFactAnswer("[Товар]({{L1}})", facts, links)).toBe(
      "[Товар](/products/product8)",
    );
    const href = "/inventory/movements/STOCK_RECEIVING%3ASTOCK_RECEIVING%3Aqa-123";
    expect(isBaamLink(href)).toBe(true);
    expect(
      renderBaamFactAnswer(
        "[Приход](/inventory/movements/STOCK_RECEIVING:STOCK_RECEIVING:qa-123)",
        facts,
        new Set([href]),
      ),
    ).toContain(href);
    expect(() => renderBaamFactAnswer("[Товар]({{L999}})", facts, links)).toThrow();
    expect(isBaamLink("/inventory/movements/%2e%2e%2fadmin")).toBe(false);
  });
  it("rejects a SKU-filtered whole-store total instead of discarding the SKU", () => {
    const { dataset, mode, ...fields } = readRequest({ query: "AI-QA-3" });
    expect(
      baamReadModelPlanSchema.safeParse({
        requests: [{ ...fields, operation: "sales_summary" }],
        format: "auto",
        clarification: null,
      }).success,
    ).toBe(false);
  });
  it("keeps supplier names with quotes, parentheses and non-Latin characters in valid links", () => {
    const href = "/suppliers?q=" + baamUriComponent("O'Brien (Азия) & Sons*");
    expect(href).toContain("%27");
    expect(href).toContain("%28");
    expect(isBaamLink(href)).toBe(true);
    expect(renderBaamFactAnswer("[Поставщик]({{L1}})", facts, new Set([href]))).toContain(href);
  });
  it("validates long malformed links in linear time and keeps application link boundaries", () => {
    expect(isBaamLink("/" + "a".repeat(100_000) + "!")).toBe(false);
    for (const href of ["/products", "/products/", "/products/product_1", "/products/123", "/reports/analytics?dateFrom=2026-10-01"]) {
      expect(isBaamLink(href)).toBe(true);
    }
    for (const href of ["//evil.example", "/api/products", "/products//x", "/products/../admin", "/products#fragment", "/products?x=1?y=2", "/inventory/movements/%2fadmin"]) {
      expect(isBaamLink(href)).toBe(false);
    }
  });
  it("escapes untrusted stored names as text rather than new links/markup", () => {
    expect(
      renderBaamFactAnswer(
        "{{F1}}",
        new Map([["F1", "[steal](https://evil.example) | <script>"]]),
        new Set(),
      ),
    ).toContain("\\[steal\\]");
  });
  it.each(["run_sql", "payments_update", "delete_customers"])(
    "cannot turn a read into %s",
    (dataset) => {
      expect(
        baamReadPlanSchema.safeParse({
          requests: [{ ...readRequest({}), dataset }],
          format: "auto",
          clarification: null,
        }).success,
      ).toBe(false);
    },
  );
  it.each(["stock_receipts_latest", "sales_latest", "customers_latest"])(
    "never silently drops a plural count on %s",
    (operation) => {
      const { dataset, mode, ...fields } = readRequest({ limit: 10 });
      expect(
        baamReadModelPlanSchema.safeParse({
          requests: [{ operation, ...fields }],
          format: "auto",
          clarification: null,
        }).success,
      ).toBe(false);
    },
  );
  it.each([0, -1, 51, 10000])("bounds requested count %s", (limit) => {
    expect(
      baamReadPlanSchema.safeParse({
        requests: [readRequest({ limit })],
        format: "auto",
        clarification: null,
      }).success,
    ).toBe(false);
  });
});

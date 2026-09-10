import { describe, it, expect } from "vitest";
import { parseBaamFastIntent } from "@/server/services/baamWorkflowIntent";
import { workflowActions, workflowSet, workflowValuesSchema } from "@/lib/baam/workflows";
import { baamActions } from "@/server/services/baamBusiness";
import { workflowFields } from "@/server/services/baamWorkflowCatalog";
import { baamReportPeriod } from "@/server/services/baamCompanion";
import { localizeWorkflowFields, workflowLabels } from "@/lib/baam/workflowLabels";
describe("BAAM deterministic workflow boundary", () => {
  it.each([
    ["Создай товар", "product_create"],
    ["Create a product", "product_create"],
    ["Товар түзүү", "product_create"],
    ["Сделай оприходование", "stock_receive"],
    ["Create sale", "pos_create_draft"],
  ])("routes %s without a model", (text, action) =>
    expect(parseBaamFastIntent(text)).toMatchObject({ kind: "action", action, source: "grammar" }),
  );
  it.each(["Как создать товар?", "How do I create a product?", "Товарды кантип кошом?"])(
    "treats %s as help, never mutation",
    (text) => expect(parseBaamFastIntent(text)).toMatchObject({ kind: "help" }),
  );
  it.each(["Не создавай товар", "Do not create a product", "Товар түзбө"])(
    "does not act on %s",
    (text) => expect(parseBaamFastIntent(text)).toMatchObject({ kind: "cancel" }),
  );
  it.each([
    "Измени название товара",
    "Создай товар и затем удали магазин",
    "Не создай, а измени товар",
    "Создай товар «Кофе», но не сохраняй его",
  ])("does not guess %s from keywords", (text) => expect(parseBaamFastIntent(text)).toBeNull());
  it("preserves a full unambiguous phrase including zero cost", () =>
    expect(
      parseBaamFastIntent(
        "Создай товар «Кофе», магазин Центр, единица шт, цена 150 сом, себестоимость 0, без фото",
      ),
    ).toMatchObject({
      kind: "action",
      parameters: {
        name: "Кофе",
        storeId: "Центр",
        baseUnitId: "шт",
        basePriceKgs: 150,
        avgCostKgs: 0,
        imageChoice: "without_photo",
      },
    }));
  it("does not invent a row for an ambiguous quantity correction", () =>
    expect(
      parseBaamFastIntent("Количество 3", undefined, {
        kind: "stock_receive",
        parameters: { lines: [{ quantity: 1 }, { quantity: 2 }] },
      }),
    ).toBeNull());
  it("changes one known row and retains its product and cost", () =>
    expect(
      parseBaamFastIntent("Количество 3", undefined, {
        kind: "stock_receive",
        parameters: { lines: [{ productId: "p", quantity: 1, unitCost: 0 }] },
      }),
    ).toMatchObject({
      kind: "correction",
      parameters: { lines: [{ productId: "p", quantity: 3, unitCost: 0 }] },
    }));
  it("covers every available business adapter with existing forms", () => {
    expect([...workflowActions].sort()).toEqual(Object.keys(baamActions).sort());
    for (const name of workflowActions) {
      const fields = workflowFields(name, "ru");
      expect(fields.length).toBeGreaterThan(0);
      const walk = (fs: typeof fields) =>
        fs.forEach((f) => {
          expect(workflowLabels[f.key], `${name}.${f.key}`).toBeDefined();
          if (f.fields) walk(f.fields);
          if (f.item?.fields) walk(f.item.fields);
        });
      walk(fields);
      for (const locale of ["en", "kg"])
        expect(localizeWorkflowFields(fields, locale).length).toBe(fields.length);
    }
  });
  it("allows optional photo and store and a genuine zero cost", () => {
    const shape = baamActions.product_create.schema;
    expect(shape.safeParse({ name: "Coffee", baseUnitId: "unit", avgCostKgs: 0 }).success).toBe(
      true,
    );
  });
  it("rejects prototype and overly deep form paths", () => {
    expect(() => workflowSet({}, "constructor.prototype.admin", true)).toThrow();
    expect(workflowValuesSchema.safeParse(JSON.parse('{"__proto__":{"admin":true}}')).success).toBe(
      false,
    );
  });
  it("uses business-day boundaries, including UTC evening and the previous calendar day", () => {
    expect(baamReportPeriod("today", new Date("2026-09-10T18:01:00Z"))).toEqual({
      dateFrom: "2026-09-11",
      dateTo: "2026-09-11",
    });
    expect(baamReportPeriod("yesterday", new Date("2026-01-01T00:01:00Z"))).toEqual({
      dateFrom: "2025-12-31",
      dateTo: "2025-12-31",
    });
  });
});

import { describe, expect, it } from "vitest";
import { bindBaamRecentRecord } from "@/server/services/baamRecentRecords";
const records = [{ kind: "product_create", resourceId: "owned-product", name: "Чай" }];
describe("Baam conversational references", () => {
  it("keeps a reference to the created product when its name is duplicated in the catalog", () => {
    expect(
      bindBaamRecentRecord(
        "Теперь измени ему цену на 175 сом",
        "product_update",
        { productId: "Чай", basePriceKgs: 175 },
        records,
      ),
    ).toEqual({ productId: "owned-product", basePriceKgs: 175 });
  });
  it("does not replace an explicitly named different product or an unrelated entity", () => {
    expect(
      bindBaamRecentRecord(
        "Теперь измени ему цену, товар Кофе",
        "product_update",
        { productId: "Кофе" },
        records,
      ),
    ).toEqual({ productId: "Кофе" });
    expect(bindBaamRecentRecord("Измени ему телефон", "customer_update", {}, records)).toEqual({});
    expect(
      bindBaamRecentRecord("Создай этот товар", "product_create", { name: "Новый" }, records),
    ).toEqual({ name: "Новый" });
  });
});

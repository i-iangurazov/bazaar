import { describe, expect, it } from "vitest";
import { catalogVariantLabel } from "@/lib/catalogVariantLabel";

describe("public catalog variant labels", () => {
  it("keeps a deliberate human-readable name", () => {
    expect(
      catalogVariantLabel(
        { id: "cmabcdefgh1234567890123456", name: "Красный / XL", attributes: { size: "L" } },
        0,
      ),
    ).toBe("Красный / XL");
  });
  it.each([null, "", "cmabcdefgh1234567890123456", "cmabcdef"])(
    "uses attributes instead of missing or generated name %s",
    (name) => {
      expect(
        catalogVariantLabel(
          {
            id: "cmabcdefgh1234567890123456",
            name,
            attributes: { color: "Синий", size: "XL", empty: "", nested: {}, zero: 0 },
          },
          0,
        ),
      ).toBe("Синий · XL · 0");
    },
  );
  it("uses a stable visible ordinal when there are no names or attributes", () => {
    expect(catalogVariantLabel({ id: "private-database-id", attributes: null }, 3)).toBe("№ 4");
  });
});

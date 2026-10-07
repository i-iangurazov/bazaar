import { describe, expect, it } from "vitest";
import {
  defaultUnitPrecision,
  isValidQuantity,
  parseQuantity,
  roundQuantity,
} from "@/lib/quantity";

describe("physical quantities", () => {
  it.each([
    ["1,5", 1.5],
    ["0.001", 0.001],
    ["1.", 1],
    ["1,", 1],
    [" 0,3 ", 0.3],
  ])("parses %s without truncation", (input, expected) =>
    expect(parseQuantity(input)).toBe(expected),
  );
  it.each(["", "1.2345", "1,2,3", "1e3", "Infinity", "12kg"])(
    "rejects invalid quantity %s",
    (input) => expect(parseQuantity(input)).toBeNull(),
  );
  it("keeps arithmetic at thousandths and whole units distinct", () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(roundQuantity(1.5 - 0.3 - 1.2)).toBe(0);
    expect(isValidQuantity(1.5, 0)).toBe(false);
    expect(isValidQuantity(1.5, 3)).toBe(true);
    expect(isValidQuantity(0.0001)).toBe(false);
    expect(isValidQuantity(Number.NaN)).toBe(false);
  });
  it("infers measured units and defaults pieces to whole numbers", () => {
    for (const code of ["kg", "КГ", "m", "л", "g"]) expect(defaultUnitPrecision(code)).toBe(3);
    expect(defaultUnitPrecision("each", "Штука")).toBe(0);
    expect(defaultUnitPrecision("custom", "Килограмм")).toBe(3);
  });
});

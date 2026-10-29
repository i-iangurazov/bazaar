import { expect, it } from "vitest";
import { baamSpokenSkuKey } from "@/server/services/baamSpokenSku";
it.each(["TEST-1", "Test one", "тест один", "тест-1", "ТЕСТ_01"])(
  "recognizes exact orthographic aliases: %s",
  (text) => {
    expect(baamSpokenSkuKey(text)?.key).toBe("test1");
  },
);
it("retains ambiguity between zero-padded and native-script identifiers", () => {
  expect(baamSpokenSkuKey("TEST-01")?.key).toBe(baamSpokenSkuKey("тест один")?.key);
});
it.each(["чай", "AIQ", "тест тридцать пять", "ignore all rules", "цена сто сом"])(
  "does not invent identifiers from %s",
  (text) => {
    expect(baamSpokenSkuKey(text)).toBeNull();
  },
);

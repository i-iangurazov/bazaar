import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { activityTranslationValues } from "@/lib/i18n/activityValues";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

describe("audit summary ICU arguments", () => {
  it.each([
    ["ru", ru, "разрешен", "запрещен"],
    ["kg", kg, "уруксат", "уруксат жок"],
    ["en", en, "true", "false"],
  ] as const)("preserves both store-policy choices in %s", (locale, messages, enabled, disabled) => {
    const t = createTranslator({ locale, messages, namespace: "audit" });
    for (const [allowNegativeStock, expected] of [[true, enabled], [false, disabled]] as const) {
      const rendered = t("summary.storePolicyUpdate", activityTranslationValues({
        storeName: "Synthetic store",
        allowNegativeStock,
      }));
      expect(rendered).toContain("Synthetic store");
      expect(rendered).toContain(expected);
      expect(rendered).not.toContain("audit.summary");
    }
  });

  it("retains numeric zero and fractional amounts and turns absent JSON values into empty text", () => {
    expect(activityTranslationValues({ quantity: 0, amount: 10.25, name: "Store", missing: null }))
      .toEqual({ quantity: 0, amount: 10.25, name: "Store", missing: "" });
    expect(activityTranslationValues()).toEqual({});
  });
});

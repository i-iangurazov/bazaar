// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({ locale: "ru" as "ru" | "kg" | "en" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    if (namespace !== "privacy") throw new Error(`Unexpected namespace ${namespace}`);
    const copy = { ru, kg, en }[state.locale].privacy;
    return (key: string) => {
      const value = copy[key as keyof typeof copy];
      if (typeof value !== "string")
        throw new Error(`Missing privacy translation ${state.locale}.${key}`);
      return value;
    };
  },
}));
import PrivacyPage, { generateMetadata } from "@/app/privacy/page";

describe("privacy matches subscription, AI and real seller processing", () => {
  it.each(["ru", "kg", "en"] as const)(
    "renders complete %s disclosures without residential details",
    async (locale) => {
      state.locale = locale;
      const copy = { ru, kg, en }[locale].privacy;
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(await PrivacyPage());
      expect(root.querySelector("h1")?.textContent).toBe(copy.title);
      for (const section of [
        "operator",
        "data",
        "purpose",
        "acquisition",
        "analytics",
        "permissions",
        "security",
        "sharing",
        "payments",
        "ai",
        "marketing",
        "retention",
        "control",
      ]) {
        expect(root.textContent).toContain(copy[`${section}Title` as keyof typeof copy]);
        expect(root.textContent).toContain(copy[`${section}Body` as keyof typeof copy]);
      }
      expect(root.textContent).toContain("GoPay");
      expect(root.textContent).toContain("FreedomPay");
      expect(root.textContent).toContain("DeepSeek");
      expect(root.textContent).toContain("OpenAI");
      expect(root.textContent).toContain("KGS");
      expect(root.textContent).toContain("+996 709 911 300");
      expect(root.textContent).not.toMatch(/\b\d{14,16}\b|placeholder/i);
      expect(root.querySelector('a[href="/help"]')).not.toBeNull();
      expect((await generateMetadata()).title).toBe(copy.metaTitle);
    },
  );
});

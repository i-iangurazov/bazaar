// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import { MarketingPricing } from "@/components/marketing/MarketingPricing";
import { PLAN_FEATURE_CODES } from "@/lib/billing/plans";
import { getPlanCatalogEntries } from "@/server/billing/planCatalog";
import { getPlanCatalog } from "@/server/services/billing";

describe("public tariff rendering", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["ru", ru],
    ["kg", kg],
    ["en", en],
  ] as const)("renders the same grants and capacities as billing in %s", (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: "billing" });
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(
      <MarketingPricing plans={getPlanCatalogEntries()} locale={locale} t={t} />,
    );
    const billing = getPlanCatalog();
    expect(root.querySelectorAll("article")).toHaveLength(3);
    for (const plan of billing) {
      const card = root.querySelector(`article[data-plan="${plan.plan}"]`)!;
      expect(card.textContent).toContain(
        t(`plans.${plan.plan.toLowerCase() as "starter" | "business" | "enterprise"}.name`),
      );
      expect(card.querySelector('a[href="/signup"]')).not.toBeNull();
      expect(plan.limits.maxStores).toBe(
        getPlanCatalogEntries().find((p) => p.code === plan.plan)?.limits.maxStores,
      );
    }
    for (const feature of PLAN_FEATURE_CODES) {
      const cells = root.querySelectorAll(`tr[data-feature="${feature}"] td`);
      expect([...cells].map((cell) => cell.getAttribute("data-included"))).toEqual(
        billing.map((p) => String(p.featureFlags[feature])),
      );
    }
    expect(root.querySelector('tr[data-feature="pos"] td')?.textContent).toBe(
      t("comparison.included"),
    );
    expect(root.textContent).not.toContain("Plan price primary");
    expect(root.textContent).not.toContain("undefined");
  });

  it("renders an exact fractional KGS override in both the card and comparison", () => {
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", "1890.50");
    const t = createTranslator({ locale: "en", messages: en, namespace: "billing" });
    const html = renderToStaticMarkup(
      <MarketingPricing plans={getPlanCatalogEntries()} locale="en" t={t} />,
    );
    expect(html).toContain("1,890.5");
    expect(html).toContain("1,890.5 KGS/month");
    expect(getPlanCatalog()[0].monthlyPriceKgs).toBe(1890.5);
  });
});

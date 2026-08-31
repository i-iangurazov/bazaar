import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("localized marketing landing", () => {
  it("generates locale-specific document and social metadata", async () => {
    const page = await readSource("src/app/page.tsx");

    expect(page).toContain("export const generateMetadata");
    expect(page).toContain('getTranslations("landing")');
    expect(page).toContain('t("meta.title")');
    expect(page).toContain('t("meta.description")');
    expect(page).not.toContain("export const metadata:");
  });

  it("renders the redesigned landing from locale messages rather than Russian-only literals", async () => {
    const landing = await readSource("src/components/marketing/MarketingLanding.tsx");
    const navigation = await readSource("src/components/marketing/MarketingNav.tsx");
    const showcase = await readSource("src/components/marketing/FeatureShowcase.tsx");

    expect(landing).toContain('getTranslations("landing")');
    expect(landing).toMatch(/<MarketingNav\s+copy=/);
    expect(landing).toContain("<FeatureShowcase");
    expect(navigation).toContain("copy:");
    expect(showcase).toContain("features:");
    for (const russianOnlyLiteral of [
      "Весь ваш магазин. В одной системе.",
      "Продавайте за секунды",
      "Начать бесплатно",
      "Правовая информация",
      "Сделано для розничной торговли Кыргызстана",
    ]) {
      expect(`${landing}\n${navigation}\n${showcase}`).not.toContain(russianOnlyLiteral);
    }
  });

  it("publishes complete locale-specific pricing and footer copy for RU, KG, and EN", async () => {
    const catalogs = await Promise.all(
      (["ru", "kg", "en"] as const).map(async (locale) => ({
        locale,
        messages: JSON.parse(await readSource(`messages/${locale}.json`)) as {
          landing: Record<string, Record<string, string>>;
        },
      })),
    );

    for (const { locale, messages } of catalogs) {
      expect(messages.landing.pricing?.title, `${locale} pricing title`).toBeTruthy();
      expect(messages.landing.pricing?.starterName, `${locale} starter plan`).toBeTruthy();
      expect(messages.landing.pricing?.networkName, `${locale} network plan`).toBeTruthy();
      expect(messages.landing.footer?.navigationLabel, `${locale} footer navigation`).toBeTruthy();
      expect(messages.landing.footer?.contact, `${locale} footer contact`).toBeTruthy();
      expect(
        messages.landing.footer?.madeForKyrgyzstan,
        `${locale} footer locale copy`,
      ).toBeTruthy();
    }

    expect(new Set(catalogs.map(({ messages }) => messages.landing.pricing.title)).size).toBe(3);
    expect(new Set(catalogs.map(({ messages }) => messages.landing.hero.title)).size).toBe(3);
  });

  it("exposes the footer link groups as a labelled navigation landmark", async () => {
    const landing = await readSource("src/components/marketing/MarketingLanding.tsx");

    expect(landing).toContain("<nav");
    expect(landing).toContain("className={styles.footerLinks}");
    expect(landing).toContain('aria-label={t("footer.navigationLabel")}');
    expect(landing).toContain("</nav>");
  });
});

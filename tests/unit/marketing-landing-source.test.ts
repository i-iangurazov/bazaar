import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("Bazaar Retail OS marketing landing", () => {
  it("uses isolated marketing components and real optimized Bazaar captures", async () => {
    const page = await readSource("src/app/page.tsx");
    const landing = await readSource("src/components/marketing/MarketingLanding.tsx");

    expect(page).toContain("@/components/marketing/MarketingLanding");
    expect(page).not.toContain("@/components/ui/");
    expect(landing).toContain('from "next/image"');
    expect(landing).toContain("/marketing/captures/pos-desktop-wide.webp");
    expect(landing).toContain("/marketing/captures/pos-mobile.webp");
    expect(landing).toContain("/marketing/captures/products-wide.webp");
    expect(landing).toContain("/marketing/captures/movements-wide.webp");
    expect(landing).toContain("/marketing/captures/dashboard-wide.webp");
    expect(landing).toContain("/marketing/captures/integrations-wide.webp");
    expect(landing).not.toContain("data:image");
  });

  it("keeps the product story, pricing, SEO and trust copy explicit and crawlable", async () => {
    const page = await readSource("src/app/page.tsx");
    const landing = await readSource("src/components/marketing/MarketingLanding.tsx");
    const ruMessages = JSON.parse(await readSource("messages/ru.json")) as {
      landing: {
        hero: { title: string };
        workflows: { sell: { title: string } };
        capabilities: { inventory: { title: string } };
        integrations: { title: string };
        mobile: { title: string };
        trust: { subtitle: string };
      };
    };
    const robots = await readSource("src/app/robots.ts");
    const sitemap = await readSource("src/app/sitemap.ts");

    expect(page).toContain("metadataBase");
    expect(page).toContain("generateMetadata");
    expect(page).toContain('getTranslations("landing")');
    expect(page).toContain("openGraph");
    expect(page).toContain("twitter");
    expect(page).toContain("canonical");
    expect(robots).toContain('sitemap: "https://www.bazaar.kg/sitemap.xml"');
    expect(robots).toContain('"/api/"');
    expect(robots).toContain('"/dashboard"');
    expect(sitemap).toContain('url: "https://www.bazaar.kg/"');
    expect(sitemap).toContain('url: "https://www.bazaar.kg/signup"');
    expect(landing).toContain('"@type": "SoftwareApplication"');
    expect(landing).toContain('getTranslations("landing")');
    expect(landing).toContain('["1750", "4375", "8750"]');
    expect(ruMessages.landing.hero.title).toBeTruthy();
    expect(ruMessages.landing.workflows.sell.title).toBeTruthy();
    expect(ruMessages.landing.capabilities.inventory.title).toBeTruthy();
    expect(ruMessages.landing.integrations.title).toBeTruthy();
    expect(ruMessages.landing.mobile.title).toBeTruthy();
    expect(ruMessages.landing.trust.subtitle).toContain(
      "не публикуем вымышленные отзывы или статистику",
    );
  });

  it("limits hydration and provides keyboard and reduced-motion behavior", async () => {
    const showcase = await readSource("src/components/marketing/FeatureShowcase.tsx");
    const motion = await readSource("src/components/marketing/MarketingMotion.tsx");
    const styles = await readSource("src/components/marketing/marketing.module.css");

    expect(showcase).toContain('role="tablist"');
    expect(showcase).toContain('role="tab"');
    expect(showcase).toContain('role="tabpanel"');
    expect(showcase).toContain('event.key === "ArrowRight"');
    expect(motion).toContain("IntersectionObserver");
    expect(motion).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("uses a readable 16:9 product frame and a structured channel status surface", async () => {
    const landing = await readSource("src/components/marketing/MarketingLanding.tsx");
    const ruMessages = JSON.parse(await readSource("messages/ru.json")) as {
      landing: { console: { singleSource: string } };
    };
    const styles = await readSource("src/components/marketing/marketing.module.css");

    expect(landing).toContain("width={1920}");
    expect(landing).toContain("height={1080}");
    expect(landing).toContain("integrationConsole");
    expect(landing).toContain('t("console.singleSource")');
    expect(ruMessages.landing.console.singleSource).toBe("Один источник данных для всех каналов");
    expect(styles).toContain("aspect-ratio: 16 / 9");
    expect(styles).not.toContain(".flowLines");
    expect(styles).not.toContain(".integrationNode");
  });
});

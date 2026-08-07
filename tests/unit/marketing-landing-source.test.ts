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
    expect(landing).toContain("/marketing/captures/pos-desktop.webp");
    expect(landing).toContain("/marketing/captures/pos-mobile.webp");
    expect(landing).toContain("/marketing/captures/products.webp");
    expect(landing).toContain("/marketing/captures/movements.webp");
    expect(landing).toContain("/marketing/captures/dashboard.webp");
    expect(landing).toContain("/marketing/captures/integrations.webp");
    expect(landing).not.toContain("data:image");
  });

  it("keeps the product story, pricing, SEO and trust copy explicit and crawlable", async () => {
    const page = await readSource("src/app/page.tsx");
    const landing = await readSource("src/components/marketing/MarketingLanding.tsx");
    const robots = await readSource("src/app/robots.ts");
    const sitemap = await readSource("src/app/sitemap.ts");

    expect(page).toContain("metadataBase");
    expect(page).toContain("openGraph");
    expect(page).toContain("twitter");
    expect(page).toContain("canonical");
    expect(robots).toContain('sitemap: "https://www.bazaar.kg/sitemap.xml"');
    expect(robots).toContain('"/api/"');
    expect(robots).toContain('"/dashboard"');
    expect(sitemap).toContain('url: "https://www.bazaar.kg/"');
    expect(sitemap).toContain('url: "https://www.bazaar.kg/signup"');
    expect(landing).toContain('"@type": "SoftwareApplication"');
    expect(landing).toContain("Весь ваш магазин. В одной системе.");
    expect(landing).toContain("Продавайте за секунды");
    expect(landing).toContain("Каждый товар под контролем");
    expect(landing).toContain("Один каталог.");
    expect(landing).toContain("Все каналы продаж.");
    expect(landing).toContain("Видите не отчёты. Видите бизнес.");
    expect(landing).toContain("Bazaar всегда с вами");
    expect(landing).toContain('price: "1750"');
    expect(landing).toContain('price: "4375"');
    expect(landing).toContain('price: "8750"');
    expect(landing).toContain("не публикует вымышленные отзывы или статистику");
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
});

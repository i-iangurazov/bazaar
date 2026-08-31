import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

const srgbLuminance = (channels: number[]) =>
  channels
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);

const whiteAlphaContrastOn = (alpha: number, background: number[]) => {
  const foreground = background.map((channel) => channel * (1 - alpha) + 255 * alpha);
  const [lighter, darker] = [srgbLuminance(foreground), srgbLuminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
};

describe("public legal and privacy routes", () => {
  it("publishes durable legal and privacy destinations in discovery metadata", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://www.bazaar.kg/legal");
    expect(urls).toContain("https://www.bazaar.kg/privacy");

    const rules = robots().rules;
    const publicAllow = Array.isArray(rules)
      ? rules.flatMap((rule) => rule.allow ?? [])
      : rules.allow;
    expect(publicAllow).toEqual(expect.arrayContaining(["/legal", "/privacy"]));
  });

  it("links the shared responsive landing footer directly to first-party pages", async () => {
    const landing = await readSource("src/components/marketing/MarketingLanding.tsx");
    const styles = await readSource("src/components/marketing/marketing.module.css");

    expect(landing).toContain('<Link href="/help">{t("footer.guide")}</Link>');
    expect(landing).toContain('<Link href="/legal">');
    expect(landing).toContain('<Link href="/privacy">');
    expect(landing).toContain("<nav className={styles.footerLinks}");
    expect(landing).not.toContain("Legal%20information");
    expect(landing).not.toContain("Privacy%20request");
    expect(styles).toContain(".marketing a:focus-visible");
  });

  it("cross-links legal discovery from Bazaar Guide with keyboard focus styling", async () => {
    const layout = await readSource("src/app/(guide)/help/layout.tsx");
    const styles = await readSource("src/components/help/help.module.css");

    expect(layout).toContain('<Link href="/privacy">');
    expect(layout).toContain('<Link href="/legal">');
    expect(styles).toContain(".footerInner a:focus-visible");
    expect(styles).toContain("flex-wrap: wrap");
  });

  it("ships the legal hub in every supported locale without pretending to publish terms", async () => {
    const legalPage = await readSource("src/app/legal/page.tsx");
    expect(legalPage).toContain('getTranslations("legal")');
    expect(legalPage).toContain('href="/privacy"');
    expect(legalPage).toContain('href="mailto:support@bazaar.kg"');
    expect(legalPage).toContain('canonical: "https://www.bazaar.kg/legal"');

    for (const locale of ["ru", "kg", "en"] as const) {
      const messages = JSON.parse(await readSource(`messages/${locale}.json`)) as Record<
        string,
        unknown
      >;
      expect(messages.legal, `${locale} legal messages`).toBeTruthy();
      expect(messages.privacy, `${locale} privacy messages`).toBeTruthy();
    }
  });

  it("keeps legal and privacy text and primary actions at AA-safe contrast levels", async () => {
    const legalPage = await readSource("src/app/legal/page.tsx");
    const privacyPage = await readSource("src/app/privacy/page.tsx");

    expect(privacyPage).toContain('text-slate-400">{t("updated")}');
    expect(privacyPage).not.toContain('text-slate-500">{t("updated")}');
    for (const page of [legalPage, privacyPage]) {
      expect(page).toContain("bg-sky-700");
      expect(page).toContain("hover:bg-sky-800");
      expect(page).not.toContain("bg-sky-500");
    }
  });

  it("keeps normal-size landing footer copy above 4.5:1 on its rendered background", async () => {
    const styles = await readSource("src/components/marketing/marketing.module.css");
    const footerBackground = styles
      .match(/\.footer\s*\{[^}]*background:\s*#([\da-f]{6})/is)?.[1]
      ?.match(/[\da-f]{2}/gi)
      ?.map((channel) => Number.parseInt(channel, 16));
    expect(footerBackground).toHaveLength(3);

    for (const selector of ["footerBrand p", "footerLinks a", "footerBottom"]) {
      const alpha = Number(
        styles.match(
          new RegExp(
            `\\.${selector.replace(" ", "\\s+")}\\s*\\{[^}]*color:\\s*rgba\\(255,\\s*255,\\s*255,\\s*([\\d.]+)`,
            "is",
          ),
        )?.[1],
      );
      expect(alpha, `${selector} should use an explicit white alpha`).toBeGreaterThan(0);
      expect(
        whiteAlphaContrastOn(alpha, footerBackground!),
        `${selector} contrast on #${footerBackground!.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

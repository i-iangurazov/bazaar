import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

describe("Bazaar Guide isolation and visual contract", () => {
  it("uses a public route group and isolated components instead of the authenticated shell", async () => {
    const layout = await read("src/app/(guide)/help/layout.tsx");
    const page = await read("src/app/(guide)/help/page.tsx");
    const home = await read("src/components/help/HelpHome.tsx");
    expect(layout).toContain("HelpHeader");
    expect(layout).not.toContain("AppShell");
    expect(page).toContain("HelpHome");
    expect(home).not.toContain("Что вы хотите сделать?");
    expect(home).toContain("/marketing/captures/pos-desktop-wide.webp");
  });

  it("keeps visual annotations translatable and separate from image pixels", async () => {
    const annotated = await read("src/components/help/AnnotatedScreenshot.tsx");
    const catalog = await read("src/content/help/catalog.ts");
    expect(annotated).toContain("media.annotations.map");
    expect(annotated).toContain("localize(item.label, locale)");
    expect(annotated).toContain('from "next/image"');
    expect(annotated).toContain("showModal");
    expect(annotated).not.toContain("annotationSpotlight");
    expect(annotated).toContain('viewBox="0 0 20 20"');
    expect(catalog).toContain("annotations");
  });

  it("uses the Bazaar product mark with an explicit Guide wordmark", async () => {
    const header = await read("src/components/help/HelpHeader.tsx");
    const styles = await read("src/components/help/help.module.css");

    expect(header).toContain('src="/brand/icon.png"');
    expect(header).toContain("<strong>BAZAAR</strong>");
    expect(header).toContain("<em>Guide</em>");
    expect(styles).toContain("aspect-ratio: 16 / 9");
  });

  it("does not import application data services or Prisma into help UI/content", async () => {
    const files = await Promise.all([
      read("src/components/help/HelpHome.tsx"),
      read("src/components/help/HelpGuidePage.tsx"),
      read("src/content/help/catalog.ts"),
      read("src/app/(guide)/help/page.tsx"),
    ]);
    expect(files.join("\n")).not.toMatch(/@prisma|server\/services|server\/db/);
  });
});

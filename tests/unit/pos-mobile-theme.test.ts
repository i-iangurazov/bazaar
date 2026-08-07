import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("mobile POS theme surfaces", () => {
  it("uses semantic theme tokens across the mobile sale, catalog, payment, and keypad flow", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/app/(app)/pos/sell/page.tsx"),
      "utf8",
    );
    const mobileSource = source.slice(
      source.indexOf("const renderMobileHeader = () =>"),
      source.indexOf("const cartSheetOpen = mobileCheckoutOpen"),
    );

    expect(mobileSource).toContain("bg-background text-foreground md:hidden");
    expect(mobileSource).toContain("border-border bg-card");
    expect(mobileSource).toContain("bg-muted");
    expect(mobileSource).toContain("text-muted-foreground");
    expect(mobileSource).toContain("bg-primary");
    expect(mobileSource).toContain("text-primary-foreground");
    expect(mobileSource).not.toMatch(/(?:bg|text|border|divide)-slate-\d{3}/);
    expect(mobileSource).not.toMatch(/(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/);
  });
});

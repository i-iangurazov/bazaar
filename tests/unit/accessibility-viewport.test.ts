import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("accessible viewport contract", () => {
  it("allows browser and assistive-technology zoom", () => {
    const layoutSource = readSource("src/app/layout.tsx");
    const providersSource = readSource("src/app/providers.tsx");

    expect(layoutSource).toContain("maximumScale: 5");
    expect(layoutSource).toContain("userScalable: true");
    expect(layoutSource).not.toContain("userScalable: false");
    expect(providersSource).not.toContain("PwaViewportLock");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA manifest", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8"),
  ) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    scope?: string;
    display?: string;
    icons?: Array<{ src?: string; sizes?: string; purpose?: string }>;
    shortcuts?: Array<{ name?: string; url?: string }>;
  };

  it("contains the required install metadata", () => {
    expect(manifest.name).toBe("Bazaar");
    expect(manifest.short_name).toBe("Bazaar");
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("includes app icons, maskable icons, and practical shortcuts", () => {
    expect(manifest.icons?.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.sizes === "512x512")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).toEqual(
      expect.arrayContaining(["/dashboard", "/pos", "/products", "/inventory"]),
    );
  });
});

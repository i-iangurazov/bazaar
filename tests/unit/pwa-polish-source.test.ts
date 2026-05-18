import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "public/manifest.webmanifest"), "utf8"),
) as {
  name?: string;
  short_name?: string;
  display?: string;
  display_override?: string[];
  theme_color?: string;
  background_color?: string;
  icons?: Array<{ purpose?: string }>;
};
const swSource = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
const globalsSource = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const providersSource = readFileSync(join(process.cwd(), "src/app/providers.tsx"), "utf8");
const mobileShellSource = readFileSync(
  join(process.cwd(), "src/components/mobile-app-shell.tsx"),
  "utf8",
);
const installButtonSource = readFileSync(
  join(process.cwd(), "src/components/pwa-install-button.tsx"),
  "utf8",
);
const offlineBannerSource = readFileSync(
  join(process.cwd(), "src/components/pwa-offline-banner.tsx"),
  "utf8",
);
const loadingSource = readFileSync(join(process.cwd(), "src/components/page-loading.tsx"), "utf8");
const appLoadingSource = readFileSync(join(process.cwd(), "src/app/(app)/loading.tsx"), "utf8");

describe("PWA polish source", () => {
  it("keeps installable manifest metadata complete", () => {
    expect(manifest.name).toBe("Bazaar");
    expect(manifest.short_name).toBe("Bazaar");
    expect(manifest.display).toBe("standalone");
    expect(manifest.display_override).toContain("standalone");
    expect(manifest.theme_color).toBe("#1d4ed8");
    expect(manifest.background_color).toBe("#ffffff");
    expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("uses safe areas and prevents horizontal mobile overflow", () => {
    expect(globalsSource).toContain("--mobile-top-safe-area");
    expect(globalsSource).toContain("--mobile-bottom-safe-area");
    expect(globalsSource).toContain("overflow-x: hidden");
    expect(mobileShellSource).toContain("env(safe-area-inset-top)");
    expect(mobileShellSource).toContain("env(safe-area-inset-bottom)");
    expect(mobileShellSource).toContain("overflow-x-hidden");
  });

  it("shows mobile offline state and app install guidance", () => {
    expect(providersSource).toContain("PwaOfflineBanner");
    expect(offlineBannerSource).toContain("navigator.onLine");
    expect(offlineBannerSource).toContain("online");
    expect(offlineBannerSource).toContain("offline");
    expect(offlineBannerSource).toContain("data-pwa-offline-banner");
    expect(installButtonSource).toContain('presentation?: "icon" | "card"');
    expect(mobileShellSource).toContain('presentation="card"');
  });

  it("has mobile skeleton loading and refreshed service worker cache", () => {
    expect(loadingSource).toContain("data-mobile-loading-skeleton");
    expect(loadingSource).toContain("animate-pulse");
    expect(appLoadingSource).toContain("PageLoading");
    expect(swSource).toContain('const STATIC_CACHE = "bazaar-static-v2"');
    expect(swSource).toContain("/offline.html");
  });
});

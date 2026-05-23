import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("public landing theme isolation", () => {
  it("keeps the root landing page in light mode even when the app theme cookie is dark", async () => {
    const layout = await readSource("src/app/layout.tsx");
    const themeSync = await readSource("src/components/theme-sync.tsx");
    const landingPage = await readSource("src/app/page.tsx");
    const forceLightTheme = await readSource("src/components/landing/ForceLightTheme.tsx");

    expect(layout).toContain("forceLandingLightThemeScript");
    expect(layout).toContain('window.location.pathname === "/"');
    expect(layout).toContain('document.documentElement.classList.remove("dark")');
    expect(layout).toContain('document.documentElement.dataset.forceLightTheme = "landing"');

    expect(themeSync).toContain("usePathname");
    expect(themeSync).toContain("isPublicLandingPath(pathname)");
    expect(themeSync).toContain('document.documentElement.classList.remove("dark")');
    expect(themeSync).toContain("pathname, session?.user.themePreference, status");

    expect(landingPage).toContain("ForceLightTheme");
    expect(landingPage).toContain("<ForceLightTheme />");

    expect(forceLightTheme).toContain('root.classList.remove("dark")');
    expect(forceLightTheme).toContain('root.dataset.forceLightTheme = "landing"');
  });
});

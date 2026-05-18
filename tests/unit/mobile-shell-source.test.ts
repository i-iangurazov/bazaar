import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appShellSource = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
const mobileShellSource = readFileSync(
  join(process.cwd(), "src/components/mobile-app-shell.tsx"),
  "utf8",
);
const mediaHookSource = readFileSync(join(process.cwd(), "src/hooks/useIsMobile.ts"), "utf8");
const dashboardSource = readFileSync(
  join(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
  "utf8",
);

describe("mobile app shell source", () => {
  it("defines the mobile shell building blocks", () => {
    expect(mobileShellSource).toContain("export const MobileAppShell");
    expect(mobileShellSource).toContain("export const MobileTopBar");
    expect(mobileShellSource).toContain("export const MobileBottomNav");
    expect(mobileShellSource).toContain("export const MobileMoreMenu");
    expect(mobileShellSource).toContain("export const MobilePageContainer");
    expect(mobileShellSource).toContain("export const MobileQuickActionButton");
    expect(mobileShellSource).toContain("export const MobileTaskCard");
    expect(mobileShellSource).toContain("env(safe-area-inset-bottom)");
    expect(mobileShellSource).toContain("md:hidden");
  });

  it("uses the below-768px mobile breakpoint", () => {
    expect(mediaHookSource).toContain('mobileShellMediaQuery = "(max-width: 767px)"');
  });

  it("keeps desktop chrome at md and wider while routing mobile bottom tabs", () => {
    expect(appShellSource).toContain('className="hidden w-64 shrink-0');
    expect(appShellSource).toContain("md:sticky md:top-0 md:flex");
    expect(appShellSource).toContain("MobileAppShell");
    expect(appShellSource).toContain('href: "/dashboard"');
    expect(appShellSource).toContain('href: "/pos"');
    expect(appShellSource).toContain('href: "/products"');
    expect(appShellSource).toContain('href: "/sales/orders"');
    expect(appShellSource).toContain('href: "/inventory"');
    expect(appShellSource).toContain('<aside className="hidden w-64 shrink-0');
    expect(appShellSource).toContain('requiredPermission: "usePos"');
    expect(appShellSource).toContain('requiredPermission: "viewProducts"');
    expect(appShellSource).toContain('requiredPermission: "viewSales"');
    expect(appShellSource).toContain('requiredPermission: "viewInventory"');
  });

  it("keeps the mobile header profile button rounded", () => {
    const profileButtonStart = mobileShellSource.indexOf('href="/settings/profile"');
    const profileButtonSource = mobileShellSource.slice(
      profileButtonStart,
      profileButtonStart + 500,
    );

    expect(profileButtonSource).toContain("button-focus-ring");
    expect(profileButtonSource).toContain("h-11 w-11");
    expect(profileButtonSource).toContain("rounded-md");
    expect(profileButtonSource).toContain("focus-visible:ring-ring/30");
  });

  it("keeps the mobile bottom nav surface and items rounded", () => {
    const bottomNavStart = mobileShellSource.indexOf("export const MobileBottomNav");
    const bottomNavSource = mobileShellSource.slice(bottomNavStart, bottomNavStart + 1800);

    expect(bottomNavSource).toContain("fixed inset-x-2 bottom-2 z-40 rounded-md border");
    expect(bottomNavSource).toContain(
      "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-md",
    );
    expect(bottomNavSource).toContain("bg-primary text-primary-foreground shadow-sm");
  });

  it("adds a mobile-only command center without replacing the desktop dashboard", () => {
    expect(dashboardSource).toContain('className="space-y-4 md:hidden"');
    expect(dashboardSource).toContain('className="hidden md:block"');
    expect(dashboardSource).toContain("MobileTaskCard");
    expect(dashboardSource).toContain("MobileQuickActionButton");
    expect(dashboardSource).toContain('href: "/inventory/receiving"');
    expect(dashboardSource).toContain("dashboard.bootstrap.useQuery");
    expect(dashboardSource).toContain("dashboard.activity.useQuery");
  });
});

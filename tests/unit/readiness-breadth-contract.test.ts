import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { helpGuideId, helpGuides } from "@/content/help/catalog";
import { consequentialGuideIds } from "@/content/help/consequential-guidance";
import type { HelpRole } from "@/content/help/types";
import { canAccessAppRoute } from "@/lib/roleAccess";
import {
  authenticatedRouteForms,
  expectedLocationForAuthenticatedRoute,
} from "../e2e/authenticated/route-inventory";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");
const locales = ["en", "ru", "kg"] as const;
const appRoleByGuideRole = {
  owner: "ADMIN",
  manager: "MANAGER",
  cashier: "CASHIER",
  stockkeeper: "STAFF",
} as const satisfies Record<HelpRole, "ADMIN" | "MANAGER" | "CASHIER" | "STAFF">;

const routeForGuideTarget = (target: string) => {
  const targetUrl = new URL(target, "http://127.0.0.1");
  return authenticatedRouteForms.find((route) => {
    if (route.pattern === `${targetUrl.pathname}${targetUrl.search}`) return true;
    if (route.pattern === targetUrl.pathname) return true;
    const finalLocation = expectedLocationForAuthenticatedRoute(route);
    return (
      finalLocation.pathname === targetUrl.pathname &&
      (targetUrl.search === "" || finalLocation.search === targetUrl.search)
    );
  });
};

describe("production-readiness breadth contracts", () => {
  it("maps all 24 Guide articles and their advertised roles to exercised authenticated routes", () => {
    expect(helpGuides).toHaveLength(24);
    expect(new Set(helpGuides.map(helpGuideId)).size).toBe(24);

    for (const guide of helpGuides) {
      const guideId = helpGuideId(guide);
      const route = routeForGuideTarget(guide.appRoute);
      expect(route, `${guideId} -> ${guide.appRoute}`).toBeDefined();

      for (const role of guide.roles) {
        expect(
          canAccessAppRoute(guide.appRoute, { role: appRoleByGuideRole[role] }),
          `${guideId} advertises ${role} for ${guide.appRoute}`,
        ).toBe(true);
      }

      expect(guide.steps.length, `${guideId} must contain instructions`).toBeGreaterThan(0);
      for (const locale of locales) {
        expect(guide.title[locale], `${guideId} ${locale} title`).not.toMatch(/^\s*$/);
        expect(guide.summary[locale], `${guideId} ${locale} summary`).not.toMatch(/^\s*$/);
        expect(guide.success[locale], `${guideId} ${locale} completion`).not.toMatch(/^\s*$/);
        for (const [index, step] of guide.steps.entries()) {
          expect(step.title[locale], `${guideId} step ${index + 1} ${locale} title`).not.toMatch(
            /^\s*$/,
          );
          expect(step.body[locale], `${guideId} step ${index + 1} ${locale} body`).not.toMatch(
            /^\s*$/,
          );
        }
      }
    }

    const guidePage = readSource("src/components/help/HelpGuidePage.tsx");
    expect(guidePage).toContain("href={guide.appRoute}");
    expect(guidePage.match(/href=\{guide\.appRoute\}/g)).toHaveLength(2);

    const routeMatrix = readSource("tests/e2e/authenticated/authenticated-routes.spec.ts");
    expect(routeMatrix).toContain("for (const route of authenticatedRouteForms)");
    expect(routeMatrix).toContain("@responsive direct authenticated layout");
  });

  it("keeps detailed control/result audits on all consequential Guide workflows", () => {
    expect(consequentialGuideIds).toHaveLength(15);
    const consequentialSteps = consequentialGuideIds.flatMap((guideId) => {
      const guide = helpGuides.find((candidate) => helpGuideId(candidate) === guideId);
      expect(guide, guideId).toBeDefined();
      return guide!.steps;
    });
    expect(consequentialSteps).toHaveLength(61);
    expect(consequentialSteps.every((step) => step.guidance)).toBe(true);
  });

  it("binds every responsive route form to an exact width and locale breadth matrix", () => {
    const config = readSource("playwright.authenticated.config.ts");
    const routeMatrix = readSource("tests/e2e/authenticated/authenticated-routes.spec.ts");
    const assertions = readSource("tests/e2e/authenticated/breadth-assertions.ts");

    for (const tuple of [
      '["desktop", 1440, 900, "en"]',
      '["tablet", 1024, 768, "ru"]',
      '["mobile", 390, 844, "kg"]',
    ]) {
      expect(config).toContain(tuple);
    }
    expect(routeMatrix).toContain("assertNoMixedLanguageMessages");
    expect(routeMatrix).toContain("assertResponsiveControlBreadth");
    expect(assertions).toContain("wide tables must use an intentional local horizontal scroller");
    expect(assertions).toContain("disabled controls must expose native disabled");
    expect(assertions).toContain("message catalog");
  });

  it("keeps explicit discard protection on the four high-risk stateful form families", () => {
    const guardedSources = [
      "src/app/(app)/customers/page.tsx",
      "src/app/(app)/suppliers/page.tsx",
      "src/app/(app)/purchase-orders/new/page.tsx",
      "src/app/(app)/pos/sell/page.tsx",
    ];
    for (const sourcePath of guardedSources) {
      const source = readSource(sourcePath);
      expect(source, sourcePath).toContain('window.addEventListener("beforeunload"');
      if (sourcePath.endsWith("/pos/sell/page.tsx")) {
        expect(source, sourcePath).toContain("hasMobilePosNavigationRisk");
        expect(source, sourcePath).toContain("mobileNavigationRiskRef.current");
      } else {
        expect(source, sourcePath).toContain('tCommon("unsavedChangesConfirm")');
      }
    }

    const browserAcceptance = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-form-reliability.spec.ts",
    );
    expect(browserAcceptance).toContain("respondToDiscardConfirmation");
    expect(browserAcceptance).toContain('"dismiss"');
    expect(browserAcceptance).toContain('"accept"');
    expect(browserAcceptance).toContain("expectNoMutation");
  });

  it("requires confirmation gates on the shared destructive-action surfaces", () => {
    for (const sourcePath of [
      "src/app/(app)/inventory/counts/[id]/page.tsx",
      "src/app/(app)/products/page.tsx",
      "src/app/(app)/products/[id]/page.tsx",
      "src/app/(app)/suppliers/page.tsx",
      "src/app/(app)/sales/orders/page.tsx",
      "src/app/(app)/sales/orders/[id]/page.tsx",
      "src/app/(app)/purchase-orders/page.tsx",
      "src/app/(app)/purchase-orders/[id]/page.tsx",
      "src/app/(app)/settings/attributes/page.tsx",
      "src/app/(app)/settings/units/page.tsx",
      "src/app/(app)/settings/users/page.tsx",
      "src/app/(app)/pos/registers/page.tsx",
      "src/app/(app)/operations/integrations/m-market/page.tsx",
      "src/app/(app)/operations/integrations/bakai-store/page.tsx",
      "src/app/(app)/operations/integrations/o-market/page.tsx",
      "src/app/(app)/operations/integrations/email-marketing/workspace.tsx",
    ]) {
      const source = readSource(sourcePath);
      expect(source, sourcePath).toContain("useConfirmDialog");
      expect(source, sourcePath).toMatch(/await confirm\s*\(|!\(await confirm\s*\(/);
      expect(source, sourcePath).toMatch(/confirmVariant:\s*"(?:danger|destructive)"/);
    }
  });
});

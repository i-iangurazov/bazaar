import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getHelpGuideById, helpRoleTracks } from "@/content/help/catalog";
import { consequentialGuideIds } from "@/content/help/consequential-guidance";
import type { HelpRole } from "@/content/help/types";
import { canAccessAppRoute } from "@/lib/roleAccess";

const locales = ["ru", "kg", "en"] as const;

const expectedWorkflows: Record<
  string,
  { route: string; routeFile: string; roles: HelpRole[]; steps: number }
> = {
  "products/import-products": {
    route: "/settings/import",
    routeFile: "src/app/(app)/settings/import/page.tsx",
    roles: ["owner"],
    steps: 5,
  },
  "inventory/receiving": {
    route: "/inventory/receiving",
    routeFile: "src/app/(app)/inventory/receiving/page.tsx",
    roles: ["owner", "manager"],
    steps: 4,
  },
  "inventory/transfer": {
    route: "/inventory/transfers",
    routeFile: "src/app/(app)/inventory/transfers/page.tsx",
    roles: ["owner", "manager"],
    steps: 4,
  },
  "inventory/write-off": {
    route: "/inventory/write-offs",
    routeFile: "src/app/(app)/inventory/write-offs/page.tsx",
    roles: ["owner", "manager"],
    steps: 4,
  },
  "inventory/inventory-count": {
    route: "/inventory/counts",
    routeFile: "src/app/(app)/inventory/counts/page.tsx",
    roles: ["owner", "manager"],
    steps: 4,
  },
  "pos/open-shift": {
    route: "/pos",
    routeFile: "src/app/(app)/pos/page.tsx",
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: 3,
  },
  "pos/make-sale": {
    route: "/pos/sell",
    routeFile: "src/app/(app)/pos/sell/page.tsx",
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: 4,
  },
  "pos/apply-discount": {
    route: "/pos/sell",
    routeFile: "src/app/(app)/pos/sell/page.tsx",
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: 4,
  },
  "pos/split-payment": {
    route: "/pos/sell",
    routeFile: "src/app/(app)/pos/sell/page.tsx",
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: 4,
  },
  "pos/hold-receipt": {
    route: "/pos/sell",
    routeFile: "src/app/(app)/pos/sell/page.tsx",
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: 3,
  },
  "pos/resume-receipt": {
    route: "/pos/sell",
    routeFile: "src/app/(app)/pos/sell/page.tsx",
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: 4,
  },
  "pos/return-sale": {
    route: "/pos/history",
    routeFile: "src/app/(app)/pos/history/page.tsx",
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: 4,
  },
  "pos/close-shift": {
    route: "/pos/shifts",
    routeFile: "src/app/(app)/pos/shifts/page.tsx",
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: 5,
  },
  "settings/add-employee": {
    route: "/settings/users",
    routeFile: "src/app/(app)/settings/users/page.tsx",
    roles: ["owner"],
    steps: 5,
  },
  "reports/export-reports": {
    route: "/reports/exports",
    routeFile: "src/app/(app)/reports/exports/page.tsx",
    roles: ["owner", "manager"],
    steps: 4,
  },
};

const roleToAppRole = {
  owner: "ADMIN",
  manager: "MANAGER",
  cashier: "CASHIER",
  stockkeeper: "STAFF",
} as const;

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("PUBLIC-011 consequential Bazaar Guide workflows", () => {
  it("covers every named workflow and all 61 steps with concrete guidance", () => {
    expect(consequentialGuideIds).toEqual(Object.keys(expectedWorkflows));

    let auditedStepCount = 0;
    for (const [guideId, expected] of Object.entries(expectedWorkflows)) {
      const guide = getHelpGuideById(guideId);
      expect(guide, guideId).toBeDefined();
      expect(guide?.steps, guideId).toHaveLength(expected.steps);
      auditedStepCount += guide?.steps.length ?? 0;

      guide?.steps.forEach((step, index) => {
        expect(step.guidance, `${guideId} step ${index + 1}`).toBeDefined();
        for (const locale of locales) {
          const location = step.guidance?.location[locale] ?? "";
          const control = step.guidance?.control[locale] ?? "";
          const result = step.guidance?.result[locale] ?? "";

          expect(
            location.length,
            `${guideId} step ${index + 1} ${locale} location`,
          ).toBeGreaterThan(10);
          expect(control.length, `${guideId} step ${index + 1} ${locale} control`).toBeGreaterThan(
            7,
          );
          expect(result.length, `${guideId} step ${index + 1} ${locale} result`).toBeGreaterThan(
            24,
          );
          expect(`${location} ${control} ${result}`).not.toMatch(
            /click here|follow the prompts|use the control|as appropriate|as needed/i,
          );
        }

        expect(step.guidance?.location.en, `${guideId} step ${index + 1} location`).toMatch(
          /→|card|row|section|panel|dialog|page|table|footer|bottom|top|bar|block|summary|journal|receipt|payments|pos/i,
        );
        expect(step.guidance?.result.en, `${guideId} step ${index + 1} success check`).toMatch(
          /appear|show|open|update|match|status|ready|enable|disable|block|recalculate|download|clear|record|restore|reduce|close|add|remain|reach|change|load|accept|highlight|become|visible|contain|post|calculate|equal|disappear/i,
        );
      });
    }

    expect(auditedStepCount).toBe(61);
  });

  it("points to app-owned routes and advertises only verified workflow roles", async () => {
    for (const [guideId, expected] of Object.entries(expectedWorkflows)) {
      const guide = getHelpGuideById(guideId)!;
      expect(guide.appRoute, guideId).toBe(expected.route);
      expect(guide.roles, guideId).toEqual(expected.roles);
      await expect(readSource(expected.routeFile), expected.routeFile).resolves.toMatch(
        /export default|const [A-Za-z]+Page/,
      );

      for (const role of expected.roles) {
        expect(
          canAccessAppRoute(expected.route, { role: roleToAppRole[role] }),
          `${guideId} should be reachable by ${role}`,
        ).toBe(true);
      }
    }

    const [productRouter, inventoryRouter, stockCountRouter, exportRouter, inviteRouter, trpc] =
      await Promise.all([
        readSource("src/server/trpc/routers/products.ts"),
        readSource("src/server/trpc/routers/inventory.ts"),
        readSource("src/server/trpc/routers/stockCounts.ts"),
        readSource("src/server/trpc/routers/exports.ts"),
        readSource("src/server/trpc/routers/invites.ts"),
        readSource("src/server/trpc/trpc.ts"),
      ]);

    expect(productRouter).toContain("importCsv: adminProcedure");
    expect(productRouter).toContain("previewImportCsv: adminProcedure");
    expect(inventoryRouter).toContain("postStockReceiving: managerProcedure");
    expect(inventoryRouter).toContain("postStockWriteOff: managerProcedure");
    expect(inventoryRouter).toContain("transfer: managerProcedure");
    expect(stockCountRouter).toContain("applyCount: stockCountsManagerProcedure");
    expect(exportRouter).toContain("create: managerProcedure");
    expect(inviteRouter).toContain("create: adminProcedure");
    expect(trpc).toContain("hasRole([Role.ADMIN, Role.MANAGER, Role.STAFF, Role.CASHIER])");
  });

  it("keeps role shortcuts aligned with the permissions declared by each guide", () => {
    for (const track of helpRoleTracks) {
      for (const guideId of track.guideIds) {
        expect(getHelpGuideById(guideId)?.roles, `${track.role} -> ${guideId}`).toContain(
          track.role,
        );
      }
    }
  });

  it("locks the audited corrections that previously sent readers to stale controls", () => {
    expect(getHelpGuideById("pos/apply-discount")?.summary.en).toContain("whole receipt");
    expect(getHelpGuideById("pos/apply-discount")?.steps[2]?.body.en).toContain(
      "does not use percentage mode",
    );
    expect(getHelpGuideById("pos/split-payment")?.steps[1]?.body.en).toContain(
      "no separate Split toggle",
    );
    expect(getHelpGuideById("pos/hold-receipt")?.steps[1]?.body.en).toContain(
      "does not ask for a separate hold note",
    );
    expect(getHelpGuideById("pos/return-sale")?.steps[3]?.body.en).toContain(
      "amount is calculated",
    );
    expect(getHelpGuideById("pos/close-shift")?.steps[0]?.body.en).toContain(
      "held receipts also block closing",
    );
    expect(getHelpGuideById("reports/export-reports")?.steps[2]?.body.en).toContain(
      "background job",
    );
  });

  it("keeps only available route-accurate captures and does not clone generic media", () => {
    const mediaSteps = consequentialGuideIds.flatMap((guideId) =>
      getHelpGuideById(guideId)!.steps.flatMap((step, index) =>
        step.media ? [{ guideId, index, src: step.media.src }] : [],
      ),
    );

    expect(mediaSteps).toEqual([
      {
        guideId: "products/import-products",
        index: 0,
        src: "/marketing/captures/products-wide.webp",
      },
      {
        guideId: "pos/make-sale",
        index: 0,
        src: "/marketing/captures/pos-desktop-wide.webp",
      },
      {
        guideId: "pos/resume-receipt",
        index: 0,
        src: "/marketing/captures/pos-desktop-wide.webp",
      },
    ]);
  });

  it("renders location, control, and success checks and publishes them in HowTo metadata", async () => {
    const [guidePage, routePage] = await Promise.all([
      readSource("src/components/help/HelpGuidePage.tsx"),
      readSource("src/app/(guide)/help/[category]/[guide]/page.tsx"),
    ]);

    expect(guidePage).toContain("<dl className={styles.stepGuidance}>");
    expect(guidePage).toContain("ui.exactLocation");
    expect(guidePage).toContain("ui.controlToUse");
    expect(guidePage).toContain("ui.expectedResult");
    expect(routePage).toContain("step.guidance.location");
    expect(routePage).toContain("step.guidance.control");
    expect(routePage).toContain("step.guidance.result");
  });
});

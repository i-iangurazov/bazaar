import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  browserZoomFactor,
  browserZoomMetricsOverride,
  browserZoomPercent,
  browserZoomProfiles,
} from "../e2e/browser-zoom-contract";

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

  it("models 200% browser zoom as layout reflow instead of visual-only scaling", () => {
    expect(browserZoomPercent).toBe(200);
    expect(browserZoomFactor).toBe(2);
    expect(browserZoomProfiles.desktop.cssWidth).toBe(640);
    expect(browserZoomProfiles.wideTable.cssWidth).toBe(960);
    expect(browserZoomProfiles.narrow.cssWidth).toBe(320);

    for (const profile of Object.values(browserZoomProfiles)) {
      const override = browserZoomMetricsOverride(profile);
      expect(profile.cssWidth * browserZoomFactor).toBe(profile.physicalWidth);
      expect(profile.cssHeight * browserZoomFactor).toBe(profile.physicalHeight);
      expect(override).toMatchObject({
        width: profile.cssWidth,
        height: profile.cssHeight,
        deviceScaleFactor: 2,
        mobile: false,
        screenWidth: profile.physicalWidth,
        screenHeight: profile.physicalHeight,
      });
    }

    const helperSource = readSource("tests/e2e/browser-zoom-assertions.ts");
    expect(helperSource).toContain('"Emulation.setDeviceMetricsOverride"');
    expect(helperSource).not.toContain('session.send("Emulation.setPageScaleFactor"');
    expect(helperSource).not.toContain("style.zoom");

    const publicConfigSource = readSource("playwright.public.config.ts");
    expect(publicConfigSource).toContain("PUBLIC_E2E_EXPECT_PRODUCTION");
    expect(publicConfigSource).toContain("playwright-authenticated-production-server.mjs");
    expect(publicConfigSource).toContain("ignoreHTTPSErrors: expectProduction");
  });

  it("keeps formal screen-reader evidence separate and preserves visible POS input focus", () => {
    const publicSource = readSource("tests/e2e/public-routes.spec.ts");
    const authenticatedSource = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-zoom-reflow.spec.ts",
    );
    const posSource = readSource("src/app/(app)/pos/sell/page.tsx");

    for (const source of [publicSource, authenticatedSource]) {
      expect(source).toContain("not evidence for BZR-REQ-0200");
    }
    expect(posSource).not.toContain("focus-visible:ring-0");
    expect(posSource).toContain("focus-visible:ring-ring/40");
  });
});

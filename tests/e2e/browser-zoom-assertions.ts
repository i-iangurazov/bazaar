import { expect, type Locator, type Page } from "@playwright/test";

import {
  browserZoomFactor,
  browserZoomMetricsOverride,
  type BrowserZoomProfile,
} from "./browser-zoom-contract";

export type BrowserZoomSnapshot = {
  cssViewport: { width: number; height: number };
  outerWindow: { width: number; height: number };
  physicalScreen: { width: number; height: number };
  devicePixelRatio: number;
  visualViewport: { width: number; height: number; scale: number } | null;
};

/**
 * Apply and prove a high-fidelity Chrome 200% browser-zoom reflow equivalent. Unlike
 * Emulation.setPageScaleFactor (pinch zoom), this changes the CSS layout viewport and DPR while
 * leaving visualViewport.scale at 1, matching desktop browser zoom semantics.
 */
export const emulateBrowserZoomReflow = async (
  page: Page,
  profile: BrowserZoomProfile,
): Promise<BrowserZoomSnapshot> => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", browserZoomMetricsOverride(profile));

  const snapshot = await page.evaluate(() => ({
    cssViewport: { width: window.innerWidth, height: window.innerHeight },
    outerWindow: { width: window.outerWidth, height: window.outerHeight },
    physicalScreen: { width: window.screen.width, height: window.screen.height },
    devicePixelRatio: window.devicePixelRatio,
    visualViewport: window.visualViewport
      ? {
          width: window.visualViewport.width,
          height: window.visualViewport.height,
          scale: window.visualViewport.scale,
        }
      : null,
  }));

  expect(snapshot.cssViewport).toEqual({ width: profile.cssWidth, height: profile.cssHeight });
  expect(snapshot.physicalScreen).toEqual({
    width: profile.physicalWidth,
    height: profile.physicalHeight,
  });
  expect(snapshot.devicePixelRatio).toBe(browserZoomFactor);
  expect(snapshot.visualViewport, "Chrome must expose VisualViewport zoom evidence").not.toBeNull();
  expect(snapshot.visualViewport!.scale, "pinch zoom must remain disabled").toBe(1);
  expect(snapshot.visualViewport!.width).toBe(profile.cssWidth);
  expect(snapshot.visualViewport!.height).toBe(profile.cssHeight);

  return snapshot;
};

export const expectNoUncontainedHorizontalClipping = async (
  page: Page,
  scope: Locator = page.locator("body"),
) => {
  const issues = await scope.evaluate((root) => {
    const viewportWidth = window.innerWidth;
    const selector = [
      "button",
      "a[href]",
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='combobox']",
      "[role='tab']",
      "[role='menuitem']",
    ].join(",");

    const isRendered = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !element.closest("[aria-hidden='true'], [inert]")
      );
    };

    const hasHorizontalScrollContainer = (element: HTMLElement) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (
          parent.scrollWidth > parent.clientWidth + 1 &&
          (style.overflowX === "auto" || style.overflowX === "scroll")
        ) {
          return true;
        }
        if (parent === root || parent === document.body) break;
      }
      return false;
    };

    return Array.from(root.querySelectorAll<HTMLElement>(selector))
      .filter(isRendered)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          (rect.left < -1 || rect.right > viewportWidth + 1) &&
          !hasHorizontalScrollContainer(element)
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: element.tagName.toLowerCase(),
          name:
            element.getAttribute("aria-label") ??
            element.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) ??
            "",
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          viewportWidth,
        };
      });
  });

  expect(
    issues,
    "interactive controls must not be clipped outside an intentional local scroller",
  ).toEqual([]);
};

export const expectNoClippedInteractiveLabels = async (scope: Locator) => {
  const clipped = await scope.evaluate((root) => {
    const selector = [
      "h1",
      "h2",
      "h3",
      "label",
      "button",
      "button span",
      "a[href]",
      "a[href] span",
      "[role='tab']",
      "[role='tab'] span",
      "[role='menuitem']",
      "[role='menuitem'] span",
    ].join(",");

    return Array.from(root.querySelectorAll<HTMLElement>(selector))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          !element.textContent?.trim()
        ) {
          return false;
        }
        const clipsOverflow =
          ["hidden", "clip"].includes(style.overflowX) ||
          ["hidden", "clip"].includes(style.overflowY);
        return (
          clipsOverflow &&
          (element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1)
        );
      })
      .map((element) => ({
        element: element.tagName.toLowerCase(),
        text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) ?? "",
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
  });

  expect(clipped, "headings and interactive labels must wrap or remain fully visible").toEqual([]);
};

export const tabUntilFocused = async (page: Page, target: Locator, maximumTabs = 200) => {
  await target.first().waitFor({ state: "visible" });
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });

  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (
      await target.evaluateAll((elements) =>
        elements.some(
          (element) =>
            element === document.activeElement || element.contains(document.activeElement),
        ),
      )
    ) {
      return;
    }
  }

  throw new Error(`Keyboard focus did not reach the requested control after ${maximumTabs} tabs.`);
};

export const expectVisibleKeyboardFocus = async (page: Page) => {
  const indicator = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const surfaces: HTMLElement[] = [active];
    let parent = active.parentElement;
    while (parent && parent !== document.body && surfaces.length < 4) {
      surfaces.push(parent);
      parent = parent.parentElement;
    }
    return {
      focusVisible: active.matches(":focus-visible"),
      surfaces: surfaces.map((surface) => {
        const style = getComputedStyle(surface);
        return {
          boxShadow: style.boxShadow,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      }),
    };
  });
  expect(indicator, "a focusable HTMLElement must own keyboard focus").not.toBeNull();
  expect(indicator?.focusVisible, "keyboard focus must match :focus-visible").toBe(true);
  const outlined = indicator?.surfaces.some(
    (surface) =>
      surface.outlineStyle !== "none" && Number.parseFloat(surface.outlineWidth ?? "0") > 0,
  );
  const ringed = indicator?.surfaces.some((surface) =>
    Boolean(surface.boxShadow && surface.boxShadow !== "none"),
  );
  expect(outlined || ringed, `focus indicator: ${JSON.stringify(indicator)}`).toBe(true);
};

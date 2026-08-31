import { expect, test as base, type Page, type Request, type TestInfo } from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export type AuthenticatedPageAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  blockedSideEffects: string[];
  externalWebSockets: string[];
  navigationRequests: string[];
};

type AuthenticatedFixtures = {
  pageAudit: AuthenticatedPageAudit;
};

const requestDescription = (request: Request) => `${request.method()} ${request.url()}`;

export const test = base.extend<AuthenticatedFixtures>({
  pageAudit: async ({ baseURL, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: AuthenticatedPageAudit = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
      blockedSideEffects: [],
      externalWebSockets: [],
      navigationRequests: [],
    };

    page.on("console", (message) => {
      if (message.type() === "error") audit.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => audit.pageErrors.push(error.message));
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        audit.navigationRequests.push(request.url());
      }
    });

    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        await route.continue();
        return;
      }
      if (url.origin !== localOrigin) {
        audit.externalRequests.push(requestDescription(request));
        await route.abort("blockedbyclient");
        return;
      }

      const method = request.method().toUpperCase();
      const isReadOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";
      if (!isReadOnly) {
        if (method === "POST" && url.pathname === "/api/help/events") {
          await route.fulfill({ status: 204, body: "" });
          return;
        }
        audit.blockedSideEffects.push(requestDescription(request));
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    await page.routeWebSocket("**/*", async (webSocket) => {
      const url = new URL(webSocket.url());
      if (url.origin === localOrigin.replace(/^http/, "ws")) {
        webSocket.connectToServer();
        return;
      }
      audit.externalWebSockets.push(webSocket.url());
      webSocket.close({ code: 1008, reason: "Authenticated E2E blocks external sockets" });
    });

    await provide(audit);
  },
});

export { expect };

export const assertNoRedirectLoop = (audit: AuthenticatedPageAudit) => {
  const chain = audit.navigationRequests;
  expect(chain.length, `redirect chain: ${chain.join(" -> ")}`).toBeLessThanOrEqual(6);
  expect(new Set(chain).size, `redirect chain repeated a URL: ${chain.join(" -> ")}`).toBe(
    chain.length,
  );
};

export const assertVisibleTerminalHeading = async (page: Page) => {
  const dialogs = page.getByRole("dialog");
  const pageHeading = page.getByRole("heading", { level: 1 }).first();
  const findVisibleDialogIndex = async () => {
    for (let index = 0; index < (await dialogs.count()); index += 1) {
      if (await dialogs.nth(index).isVisible()) return index;
    }
    return -1;
  };

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const visibleDialogIndex = await findVisibleDialogIndex();
    if (visibleDialogIndex >= 0) {
      const dialog = dialogs.nth(visibleDialogIndex);
      try {
        await expect(dialog).toHaveAccessibleName(/\S/, { timeout: 1_000 });
        const dialogHeading = dialog.getByRole("heading").first();
        await expect(dialogHeading).toBeVisible({ timeout: 1_000 });
        await expect(dialogHeading).not.toHaveText(/^\s*$/, { timeout: 1_000 });
        await expect(page.locator("[aria-busy='true'], [data-loading='true']")).toHaveCount(0);
        return;
      } catch (error) {
        if (await dialog.isVisible().catch(() => false)) throw error;
      }
    }

    if (await pageHeading.isVisible().catch(() => false)) {
      try {
        await expect(pageHeading).not.toHaveText(/^\s*$/, { timeout: 1_000 });
        await expect(page.locator("[aria-busy='true'], [data-loading='true']")).toHaveCount(0);
        return;
      } catch (error) {
        if (await pageHeading.isVisible().catch(() => false)) throw error;
      }
    }

    await page.waitForTimeout(50);
  }

  throw new Error("Page did not expose a visible named dialog or non-empty H1 within 20 seconds.");
};

export const assertDocumentTitleMatchesHeading = async (page: Page) => {
  const visibleDialog = page.getByRole("dialog").first();
  if (await visibleDialog.isVisible().catch(() => false)) {
    const dialogHeading = visibleDialog.getByRole("heading").first();
    await expect(dialogHeading).toBeVisible();
    await expect(dialogHeading).not.toHaveText(/^\s*$/);
  }

  const visibleHeadingText = () =>
    page.locator("h1").evaluateAll((headings) => {
      const heading = headings.find((candidate) => {
        const style = window.getComputedStyle(candidate);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          candidate.getClientRects().length > 0
        );
      });
      return (heading as HTMLElement | undefined)?.innerText.replace(/\s+/g, " ").trim() ?? "";
    });
  await expect
    .poll(visibleHeadingText, { message: "the primary heading must not be empty" })
    .not.toBe("");

  const pathname = new URL(page.url()).pathname;
  const usesAuthenticatedShell = (await page.locator("aside[data-sidebar]").count()) > 0;
  if (!usesAuthenticatedShell && pathname !== "/pos/sell") {
    await expect.poll(async () => (await page.title()).trim().length > 0).toBe(true);
    return;
  }

  await expect
    .poll(async () => {
      const headingText = await visibleHeadingText();
      return Boolean(headingText) && (await page.title()).startsWith(`${headingText} | `);
    })
    .toBe(true);
};

export const assertMeaningfulPrimaryHeading = async (page: Page) => {
  const headings = page.locator("h1:visible");
  await expect(headings, "the rendered route must expose exactly one visible H1").toHaveCount(1);
  await expect(headings.first(), "the route H1 must contain meaningful text").toHaveText(/\S.{1,}/);
};

export const assertVisibleInteractiveControlsNamed = async (page: Page) => {
  const controls = page.locator(
    "button:not([aria-hidden='true']):visible, a[href]:not([aria-hidden='true']):visible, input:not([type='hidden']):not([aria-hidden='true']):visible, textarea:not([aria-hidden='true']):visible, select:not([aria-hidden='true']):visible, summary:not([aria-hidden='true']):visible, [role='button']:not([aria-hidden='true']):visible, [role='link']:not([aria-hidden='true']):visible, [role='combobox']:not([aria-hidden='true']):visible",
  );
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    const hiddenFromAccessibilityTree = await control.evaluate(
      (element) => element.closest("[aria-hidden='true'], [inert], [hidden]") !== null,
    );
    if (hiddenFromAccessibilityTree) {
      continue;
    }
    await expect(
      control,
      `visible interactive control ${index + 1}/${count} at ${new URL(page.url()).pathname}`,
    ).toHaveAccessibleName(/\S/);
  }
};

export const assertNoRawTranslationArtifacts = async (page: Page) => {
  const visibleCopy = await page.locator("body").innerText();
  expect(visibleCopy, "the route must not render a missing-message marker").not.toMatch(
    /\[\[missing:|MISSING_MESSAGE|INVALID_MESSAGE/i,
  );
};

export const assertNoRootOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth, body?.scrollWidth ?? 0) - root.clientWidth;
  });
  expect(overflow, "root document must not overflow horizontally").toBeLessThanOrEqual(1);
};

const expectedTerminalConsoleError = (message: string) =>
  /failed to load resource.*(?:400|403|404)|(?:400|403|404).*failed to load resource/i.test(
    message,
  );

export const assertCleanPageAudit = (
  audit: AuthenticatedPageAudit,
  options: { allowExpectedTerminal404?: boolean } = {},
) => {
  const consoleErrors = options.allowExpectedTerminal404
    ? audit.consoleErrors.filter((message) => !expectedTerminalConsoleError(message))
    : audit.consoleErrors;
  expect(consoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedSideEffects, "unexpected mutation/side-effect requests").toEqual([]);
};

export const attachAuditOnFailure = async (testInfo: TestInfo, audit: AuthenticatedPageAudit) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("authenticated-page-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

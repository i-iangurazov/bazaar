import type { Page, TestInfo } from "@playwright/test";

import {
  assertNoMixedLanguageMessages,
  assertResponsiveControlBreadth,
  type BreadthLocale,
} from "./breadth-assertions";
import type { AuthenticatedE2EBaseRole } from "./contract";
import {
  authenticatedDynamicRoutes,
  authenticatedRouteForms,
  expectedDeniedLocation,
  expectedLocationForAuthenticatedRoute,
  type AuthenticatedRouteDefinition,
  type AuthenticatedRouteLocation,
} from "./route-inventory";
import {
  assertCleanPageAudit,
  assertDocumentTitleMatchesHeading,
  assertMeaningfulPrimaryHeading,
  assertNoRedirectLoop,
  assertNoRawTranslationArtifacts,
  assertNoRootOverflow,
  assertVisibleInteractiveControlsNamed,
  assertVisibleTerminalHeading,
  attachAuditOnFailure,
  expect,
  test,
  type AuthenticatedPageAudit,
} from "./test-fixtures";

type RoleProjectMetadata = {
  role: AuthenticatedE2EBaseRole;
  accountKey: string;
  locale?: BreadthLocale;
};

const projectMetadata = (testInfo: TestInfo) => testInfo.project.metadata as RoleProjectMetadata;

const assertLocation = async (page: Page, expected: AuthenticatedRouteLocation) => {
  await expect
    .poll(() => {
      const location = new URL(page.url());
      return {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      };
    })
    .toEqual({
      pathname: expected.pathname,
      search: expected.search ?? "",
      hash: expected.hash ?? "",
    });
};

const gotoDirect = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `direct navigation to ${path} must produce a document response`).not.toBeNull();
  return response!;
};

const assertStablePage = async (
  page: Page,
  audit: AuthenticatedPageAudit,
  options: {
    allowExpectedTerminal404?: boolean;
    breadthLocale?: BreadthLocale;
  } = {},
) => {
  await assertVisibleTerminalHeading(page);
  await assertMeaningfulPrimaryHeading(page);
  await assertDocumentTitleMatchesHeading(page);
  await assertNoRootOverflow(page);
  await assertVisibleInteractiveControlsNamed(page);
  await assertNoRawTranslationArtifacts(page);
  if (options.breadthLocale) {
    await assertNoMixedLanguageMessages(page, options.breadthLocale);
    await assertResponsiveControlBreadth(page);
  }
  await page.waitForTimeout(500);
  await assertVisibleTerminalHeading(page);
  await assertMeaningfulPrimaryHeading(page);
  await assertDocumentTitleMatchesHeading(page);
  await assertNoRootOverflow(page);
  assertNoRedirectLoop(audit);
  assertCleanPageAudit(audit, options);
};

const isAllowedForRoleMatrix = (
  route: AuthenticatedRouteDefinition,
  role: AuthenticatedE2EBaseRole,
) => !route.ownerRequirement && route.allowedRoles.includes(role);

const expectProductionNotFound = (route: AuthenticatedRouteDefinition) =>
  route.productionOnlyNotFound && process.env.AUTHENTICATED_E2E_EXPECT_PRODUCTION === "1";

const assertProductionNotFoundPage = async (page: Page) => {
  // App Router can stream the document shell with HTTP 200 before notFound()
  // resolves. The rendered terminal state is therefore the authoritative check.
  await expect(page.getByRole("heading", { level: 1, name: "404", exact: true })).toBeVisible();
  const explanation = page.getByRole("heading", { level: 2 }).first();
  await expect(explanation).toBeVisible();
  await expect(explanation).not.toHaveText(/^\s*$/);
};

const assertNoMutationControls = async (page: Page) => {
  const main = page.locator("main").first();
  const scope = (await main.count()) > 0 ? main : page.locator("body");
  await expect(scope.locator("form")).toHaveCount(0);
  await expect(
    scope.locator("input:not([type='hidden']):not([data-tour='scan-input']), select, textarea"),
  ).toHaveCount(0);
  await expect(
    scope.getByRole("button", {
      name: /save|apply|create|delete|submit|retry|сохран|примен|созда|удал|отправ|кайра|сакта|өчүр|түз/i,
    }),
  ).toHaveCount(0);
};

test.afterEach(async ({ pageAudit }, testInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

for (const route of authenticatedRouteForms) {
  test(`@role-matrix direct role decision: ${route.id}`, async ({ page, pageAudit }, testInfo) => {
    const { role } = projectMetadata(testInfo);
    const response = await gotoDirect(page, route.path);
    const isAllowed = isAllowedForRoleMatrix(route, role);
    let terminalLocation: AuthenticatedRouteLocation;

    if (isAllowed) {
      terminalLocation = expectedLocationForAuthenticatedRoute(route);
      await assertLocation(page, terminalLocation);
      if (expectProductionNotFound(route)) expect([200, 404]).toContain(response.status());
      else expect(response.status()).toBeLessThan(500);
    } else {
      terminalLocation = expectedDeniedLocation(role, route.path);
      await assertLocation(page, terminalLocation);
      expect(response.status()).toBeLessThan(500);
    }

    await assertStablePage(page, pageAudit, {
      allowExpectedTerminal404: Boolean(isAllowed && expectProductionNotFound(route)),
    });
    if (isAllowed && expectProductionNotFound(route)) await assertProductionNotFoundPage(page);
    await assertLocation(page, terminalLocation);
  });
}

test("@owner-org organization owner can open diagnostics directly", async ({ page, pageAudit }) => {
  const route = authenticatedRouteForms.find((entry) => entry.ownerRequirement === "organization");
  expect(route).toBeDefined();
  const response = await gotoDirect(page, route!.path);
  expect(response.status()).toBeLessThan(500);
  await assertLocation(page, expectedLocationForAuthenticatedRoute(route!));
  await assertStablePage(page, pageAudit);
  await assertLocation(page, expectedLocationForAuthenticatedRoute(route!));
});

test("@owner-platform platform owner can open the platform console directly", async ({
  page,
  pageAudit,
}) => {
  const route = authenticatedRouteForms.find((entry) => entry.ownerRequirement === "platform");
  expect(route).toBeDefined();
  const response = await gotoDirect(page, route!.path);
  expect(response.status()).toBeLessThan(500);
  await assertLocation(page, expectedLocationForAuthenticatedRoute(route!));
  await assertStablePage(page, pageAudit);
  await assertLocation(page, expectedLocationForAuthenticatedRoute(route!));
});

for (const routeCase of authenticatedDynamicRoutes) {
  test(`@dynamic owned record resolves: ${routeCase.id}`, async ({ page, pageAudit }) => {
    const response = await gotoDirect(page, routeCase.validPath);
    expect(response.status()).toBeLessThan(500);
    await assertLocation(page, { pathname: new URL(routeCase.validPath, "http://local").pathname });
    await assertStablePage(page, pageAudit);
    await assertLocation(page, { pathname: new URL(routeCase.validPath, "http://local").pathname });
  });

  for (const terminalCase of [
    ["cross-tenant", routeCase.foreignPath],
    ["malformed", routeCase.malformedPath],
    ["missing", routeCase.missingPath],
  ] as const) {
    test(`@dynamic ${terminalCase[0]} record is terminal: ${routeCase.id}`, async ({
      page,
      pageAudit,
    }) => {
      const response = await gotoDirect(page, terminalCase[1]);
      expect([200, 404]).toContain(response.status());
      await assertLocation(page, {
        pathname: new URL(terminalCase[1], "http://local").pathname,
      });
      await assertStablePage(page, pageAudit, { allowExpectedTerminal404: true });
      await assertLocation(page, {
        pathname: new URL(terminalCase[1], "http://local").pathname,
      });
      await assertNoMutationControls(page);
    });
  }
}

for (const route of authenticatedRouteForms) {
  test(`@responsive direct authenticated layout: ${route.id}`, async ({
    page,
    pageAudit,
    baseURL,
  }, testInfo) => {
    expect(baseURL).toBeTruthy();
    const { locale } = projectMetadata(testInfo);
    expect(locale, `${testInfo.project.name} must declare its breadth locale`).toBeTruthy();
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale!, url: baseURL! }]);
    const response = await gotoDirect(page, route.path);
    await assertLocation(page, expectedLocationForAuthenticatedRoute(route));
    if (expectProductionNotFound(route)) expect([200, 404]).toContain(response.status());
    else expect(response.status()).toBeLessThan(500);
    await assertStablePage(page, pageAudit, {
      allowExpectedTerminal404: Boolean(expectProductionNotFound(route)),
      ...(!expectProductionNotFound(route) ? { breadthLocale: locale } : {}),
    });
    if (expectProductionNotFound(route)) await assertProductionNotFoundPage(page);
    await assertLocation(page, expectedLocationForAuthenticatedRoute(route));
  });
}

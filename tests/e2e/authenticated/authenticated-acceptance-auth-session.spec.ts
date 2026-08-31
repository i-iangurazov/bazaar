import {
  request as playwrightRequest,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  assertAuthenticatedE2EBaseUrl,
  authenticatedE2EAccounts,
  authenticatedE2EIds,
  authenticatedE2EPassword,
  authenticatedE2EStorageStatePath,
} from "./contract";
import { attachAuditOnFailure, expect, test, type AuthenticatedPageAudit } from "./test-fixtures";

const loginTitle = "Inventory platform";
const adminAccount = authenticatedE2EAccounts.admin;
const sessionCookiePattern = /(?:^|\.)session-token$/;
type AllowedAuthMutation = {
  method: string;
  pathname: string;
};

type SecondaryPageAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  blockedSideEffects: string[];
  externalWebSockets: string[];
};

const locationSnapshot = (page: Page) => {
  const url = new URL(page.url());
  return { pathname: url.pathname, search: url.search };
};

const expectLocation = async (page: Page, pathname: string, search = "") => {
  await expect.poll(() => locationSnapshot(page)).toEqual({ pathname, search });
};

const prepareSignedOutBrowser = async (page: Page, baseURL: string | undefined) => {
  const baseOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: "NEXT_LOCALE",
      value: "en",
      url: baseOrigin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return baseOrigin;
};

const allowExpectedAuthMutations = async (page: Page, allowedPaths: readonly string[]) => {
  const allowed = new Set(allowedPaths);
  const observed: AllowedAuthMutation[] = [];

  await page.route("**/api/auth/**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const pathname = new URL(request.url()).pathname;
    if (method === "POST" && allowed.has(pathname)) {
      observed.push({ method, pathname });
      await route.continue();
      return;
    }
    await route.fallback();
  });

  return observed;
};

const assertAuditSafe = (
  audit: AuthenticatedPageAudit,
  options: { allowCredentialFailures?: boolean } = {},
) => {
  const unexpectedConsoleErrors = options.allowCredentialFailures
    ? audit.consoleErrors.filter(
        (message) => !/failed to load resource.*(?:400|401)/i.test(message),
      )
    : audit.consoleErrors;
  expect(unexpectedConsoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedSideEffects, "unexpected mutation/side-effect requests").toEqual([]);
};

const assertSecondaryAuditSafe = (
  audit: SecondaryPageAudit,
  options: { allowAuthorizationFailures?: boolean } = {},
) => {
  const unexpectedConsoleErrors = options.allowAuthorizationFailures
    ? audit.consoleErrors.filter(
        (message) => !/failed to load resource.*(?:401|403)/i.test(message),
      )
    : audit.consoleErrors;
  expect(unexpectedConsoleErrors, "unexpected second-tab console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected second-tab page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected second-tab external requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected second-tab external sockets").toEqual([]);
  expect(audit.blockedSideEffects, "unexpected second-tab side effects").toEqual([]);
};

const installReadOnlyPageSafety = async (page: Page, localOrigin: string) => {
  const audit: SecondaryPageAudit = {
    consoleErrors: [],
    pageErrors: [],
    externalRequests: [],
    blockedSideEffects: [],
    externalWebSockets: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") audit.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => audit.pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      await route.continue();
      return;
    }
    if (url.origin !== localOrigin) {
      audit.externalRequests.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }

    const method = request.method().toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      audit.blockedSideEffects.push(`${method} ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await page.routeWebSocket("**/*", async (webSocket) => {
    if (new URL(webSocket.url()).origin === localOrigin.replace(/^http/, "ws")) {
      webSocket.connectToServer();
      return;
    }
    audit.externalWebSockets.push(webSocket.url());
    webSocket.close({ code: 1008, reason: "Authenticated acceptance blocks external sockets" });
  });

  return audit;
};

const expectLoginPageWithoutSensitiveContent = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1, name: loginTitle })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(adminAccount.email);
  await expect(page.getByRole("navigation")).toHaveCount(0);
};

const getSessionCookie = async (context: BrowserContext) => {
  const sessionCookie = (await context.cookies()).find((cookie) =>
    sessionCookiePattern.test(cookie.name),
  );
  expect(sessionCookie, "the authenticated fixture must contain a session cookie").toBeDefined();
  expect(sessionCookie!.httpOnly).toBe(true);
  expect(sessionCookie!.secure).toBe(true);
  return sessionCookie!;
};

const expectAnonymousSession = async (context: BrowserContext, baseOrigin: string) => {
  const response = await context.request.get(`${baseOrigin}/api/auth/session`, {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({});
};

const attachSecondaryAudit = async (testInfo: TestInfo, audit: SecondaryPageAudit) => {
  await testInfo.attach("authenticated-second-tab-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

test.afterEach(async ({ pageAudit }, testInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

test("invalid password and unknown account fail with the same generic result", async ({
  baseURL,
  page,
  pageAudit,
}) => {
  await prepareSignedOutBrowser(page, baseURL);
  const authMutations = await allowExpectedAuthMutations(page, ["/api/auth/callback/credentials"]);
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  const alert = page.locator('form p[role="alert"]');

  await email.fill(adminAccount.email);
  await password.fill("Incorrect-Password-2026!");
  await submit.click();
  await expect.poll(() => authMutations.length).toBe(1);
  await expect(alert).toBeVisible();
  const invalidPasswordMessage = (await alert.innerText()).trim();

  await email.fill("unknown-auth-acceptance@auth-e2e.test");
  await password.fill("Incorrect-Password-2026!");
  await submit.click();
  await expect.poll(() => authMutations.length).toBe(2);
  await expect(alert).toBeVisible();
  const unknownAccountMessage = (await alert.innerText()).trim();

  expect(invalidPasswordMessage).toBe("Invalid email or password.");
  expect(unknownAccountMessage).toBe(invalidPasswordMessage);

  // A successful attempt clears the one deliberate failure for the shared seeded admin.
  await email.fill(adminAccount.email);
  await password.fill(authenticatedE2EPassword);
  await submit.click();
  await expectLocation(page, "/dashboard");
  expect(authMutations).toEqual([
    { method: "POST", pathname: "/api/auth/callback/credentials" },
    { method: "POST", pathname: "/api/auth/callback/credentials" },
    { method: "POST", pathname: "/api/auth/callback/credentials" },
  ]);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  assertAuditSafe(pageAudit, { allowCredentialFailures: true });
});

test("login fields validate, remain masked, submit by Enter, and never expose credentials", async ({
  baseURL,
  page,
  pageAudit,
}) => {
  await prepareSignedOutBrowser(page, baseURL);
  const authMutations = await allowExpectedAuthMutations(page, ["/api/auth/callback/credentials"]);
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Sign in", exact: true });

  await submit.click();
  await expect(page.getByText("Email is required.", { exact: true })).toBeVisible();
  await expect(page.getByText("Password is required.", { exact: true })).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  expect(authMutations).toEqual([]);

  await email.fill("not-an-email");
  await password.fill("masked-value");
  await password.press("Enter");
  await expect(page.getByText("Enter a valid email.", { exact: true })).toBeVisible();
  await expect(password).toHaveAttribute("type", "password");
  expect(authMutations).toEqual([]);

  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");

  await email.fill(adminAccount.email);
  await password.fill(authenticatedE2EPassword);
  await password.press("Enter");
  await expectLocation(page, "/dashboard");
  expect(authMutations).toEqual([{ method: "POST", pathname: "/api/auth/callback/credentials" }]);
  expect(page.url()).not.toContain(encodeURIComponent(adminAccount.email));
  await expect(page.locator("body")).not.toContainText(authenticatedE2EPassword);
  assertAuditSafe(pageAudit);
});

test("rapid repeated login submission is de-duplicated and returns to the protected origin", async ({
  baseURL,
  page,
  pageAudit,
}) => {
  await prepareSignedOutBrowser(page, baseURL);
  const authMutations = await allowExpectedAuthMutations(page, ["/api/auth/callback/credentials"]);

  await page.goto("/reports", { waitUntil: "domcontentloaded" });
  await expectLocation(page, "/login", "?next=%2Freports");
  await page.getByLabel("Email", { exact: true }).fill(adminAccount.email);
  await page.getByLabel("Password", { exact: true }).fill(authenticatedE2EPassword);

  await page.getByRole("button", { name: "Sign in", exact: true }).dblclick();
  await expectLocation(page, "/reports");
  expect(authMutations).toEqual([{ method: "POST", pathname: "/api/auth/callback/credentials" }]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectLocation(page, "/reports");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  assertAuditSafe(pageAudit);
});

test("an authenticated user opening login is redirected to the role home", async ({
  page,
  pageAudit,
}) => {
  const response = await page.goto("/login?next=/reports", { waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await expectLocation(page, "/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
  assertAuditSafe(pageAudit);
});

test("logout invalidates both tabs, protects Back, and blocks direct protected routes", async ({
  baseURL,
  page,
  pageAudit,
}, testInfo) => {
  const baseOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
  const authMutations = await allowExpectedAuthMutations(page, ["/api/auth/signout"]);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const secondPage = await page.context().newPage();
  const secondAudit = await installReadOnlyPageSafety(secondPage, baseOrigin);
  try {
    await secondPage.goto("/reports", { waitUntil: "domcontentloaded" });
    await expectLocation(secondPage, "/reports");
    await expect(secondPage.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expectLocation(page, "/login");
    await expectLoginPageWithoutSensitiveContent(page);
    expect(authMutations).toEqual([{ method: "POST", pathname: "/api/auth/signout" }]);
    await expectAnonymousSession(page.context(), baseOrigin);

    await page.goBack({ waitUntil: "domcontentloaded" });
    await expectLocation(page, "/login", "?next=%2Fdashboard");
    await expectLoginPageWithoutSensitiveContent(page);

    await secondPage.reload({ waitUntil: "domcontentloaded" });
    await expectLocation(secondPage, "/login", "?next=%2Freports");
    await expectLoginPageWithoutSensitiveContent(secondPage);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expectLocation(page, "/login", "?next=%2Fdashboard");
    await expectLoginPageWithoutSensitiveContent(page);
    assertSecondaryAuditSafe(secondAudit, { allowAuthorizationFailures: true });
  } finally {
    await attachSecondaryAudit(testInfo, secondAudit);
    await secondPage.close();
  }
  assertAuditSafe(pageAudit);
});

test("tampered and expired session cookies fail closed without protected content", async ({
  baseURL,
  page,
  pageAudit,
}) => {
  const baseOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
  const context = page.context();
  const originalSessionCookie = await getSessionCookie(context);

  await context.addCookies([
    { ...originalSessionCookie, value: "tampered.invalid.authenticated-e2e-session" },
  ]);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expectLocation(page, "/login", "?next=%2Fdashboard");
  await expectLoginPageWithoutSensitiveContent(page);
  await expectAnonymousSession(context, baseOrigin);

  await context.addCookies([originalSessionCookie]);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expectLocation(page, "/dashboard");

  await context.addCookies([
    {
      ...originalSessionCookie,
      expires: Math.floor(Date.now() / 1000) - 60,
    },
  ]);
  await page.goto("/reports", { waitUntil: "domcontentloaded" });
  await expectLocation(page, "/login", "?next=%2Freports");
  await expectLoginPageWithoutSensitiveContent(page);
  await expectAnonymousSession(context, baseOrigin);
  assertAuditSafe(pageAudit);
});

test("loss of session during an active non-destructive form discards sensitive page content", async ({
  page,
  pageAudit,
}) => {
  const sentinel = "AUTH-SESSION-LOSS-UNSAVED-CONTENT";
  await page.goto("/products/new", { waitUntil: "domcontentloaded" });
  await expectLocation(page, "/products/new");

  const nameInput = page.getByLabel("Name", { exact: true }).first();
  await expect(nameInput).toBeVisible();
  await nameInput.fill(sentinel, { force: true });
  await expect(nameInput).toHaveValue(sentinel);

  await page.context().clearCookies();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectLocation(page, "/login", "?next=%2Fproducts%2Fnew");
  await expectLoginPageWithoutSensitiveContent(page);
  await expect(page.locator("body")).not.toContainText(sentinel);
  const retainedBrowserState = await page.evaluate(() => {
    return `${Object.values(localStorage).join("\n")}\n${Object.values(sessionStorage).join("\n")}`;
  });
  expect(retainedBrowserState).not.toContain(sentinel);
  assertAuditSafe(pageAudit);
});

test("a STAFF session is denied at the in-page store-policy mutation boundary", async ({
  baseURL,
  pageAudit,
}) => {
  const baseOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
  const staffRequest = await playwrightRequest.newContext({
    baseURL: baseOrigin,
    ignoreHTTPSErrors: true,
    storageState: authenticatedE2EStorageStatePath("staff"),
  });
  try {
    const response = await staffRequest.post("/api/trpc/stores.updatePolicy?batch=1", {
      data: {
        0: {
          json: {
            storeId: `${authenticatedE2EIds.primaryStore}_nonexistent`,
            allowNegativeStock: false,
            trackExpiryLots: false,
          },
        },
      },
      headers: {
        "content-type": "application/json",
        "x-request-id": "authenticated-acceptance-staff-denied-store-policy",
      },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(403);
    const body = (await response.json()) as unknown;
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('"code":"FORBIDDEN"');
    expect(serialized).toContain('"httpStatus":403');
    expect(serialized).not.toContain(authenticatedE2EIds.primaryStore);
    expect(serialized).not.toContain(adminAccount.email);
  } finally {
    await staffRequest.dispose();
  }
  assertAuditSafe(pageAudit);
});

import {
  expect,
  test as base,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export const employeeInvitationMutationProcedures = [
  "invites.create",
  "publicAuth.acceptInvite",
] as const;

export type EmployeeInvitationMutationProcedure =
  (typeof employeeInvitationMutationProcedures)[number];

export type EmployeeInvitationAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  allowedMutations: EmployeeInvitationMutationProcedure[];
  allowedLocaleWrites: number;
  allowedCredentialCallbacks: number;
  blockedLocalMutations: string[];
};

type EmployeeInvitationFixtures = {
  employeeInvitationAudit: EmployeeInvitationAudit;
  signedOutEmployeePage: Page;
};
const allowedProcedures = new Set<string>(employeeInvitationMutationProcedures);
const requestDescription = (request: Request) => `${request.method()} ${request.url()}`;

const readProcedures = (url: URL) =>
  url.pathname.startsWith("/api/trpc/")
    ? decodeURIComponent(url.pathname.slice("/api/trpc/".length))
        .split(",")
        .map((procedure) => procedure.trim())
        .filter(Boolean)
    : [];

const instrumentEmployeeInvitationPage = async (
  page: Page,
  localOrigin: string,
  audit: EmployeeInvitationAudit,
) => {
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
      audit.externalRequests.push(requestDescription(request));
      await route.abort("blockedbyclient");
      return;
    }

    const method = request.method().toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      await route.continue();
      return;
    }
    if (method === "POST" && url.pathname === "/api/help/events") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (method === "POST" && url.pathname === "/api/locale") {
      audit.allowedLocaleWrites += 1;
      await route.continue();
      return;
    }
    if (method === "POST" && url.pathname === "/api/auth/callback/credentials") {
      audit.allowedCredentialCallbacks += 1;
      await route.continue();
      return;
    }

    const procedures = readProcedures(url);
    if (
      method === "POST" &&
      procedures.length > 0 &&
      procedures.every((procedure) => allowedProcedures.has(procedure))
    ) {
      audit.allowedMutations.push(...(procedures as EmployeeInvitationMutationProcedure[]));
      await route.continue();
      return;
    }

    audit.blockedLocalMutations.push(requestDescription(request));
    await route.abort("blockedbyclient");
  });

  await page.routeWebSocket("**/*", async (webSocket) => {
    const url = new URL(webSocket.url());
    if (url.origin === localOrigin.replace(/^http/, "ws")) {
      webSocket.connectToServer();
      return;
    }
    audit.externalWebSockets.push(webSocket.url());
    webSocket.close({ code: 1008, reason: "Employee invitation E2E blocks external sockets" });
  });
};

export const test = base.extend<EmployeeInvitationFixtures>({
  employeeInvitationAudit: async ({ baseURL, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: EmployeeInvitationAudit = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
      externalWebSockets: [],
      allowedMutations: [],
      allowedLocaleWrites: 0,
      allowedCredentialCallbacks: 0,
      blockedLocalMutations: [],
    };

    await instrumentEmployeeInvitationPage(page, localOrigin, audit);

    await provide(audit);
  },
  signedOutEmployeePage: async ({ baseURL, browser, employeeInvitationAudit }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const context = await browser.newContext({
      baseURL: localOrigin,
      ignoreHTTPSErrors: true,
      locale: "en-US",
      colorScheme: "light",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1440, height: 900 },
    });
    await context.addCookies([
      {
        name: "NEXT_LOCALE",
        value: "en",
        url: localOrigin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const signedOutPage = await context.newPage();
    await instrumentEmployeeInvitationPage(signedOutPage, localOrigin, employeeInvitationAudit);
    try {
      await provide(signedOutPage);
    } finally {
      await context.close();
    }
  },
});

export const employeeInvitationMutationCount = (
  audit: EmployeeInvitationAudit,
  procedure: EmployeeInvitationMutationProcedure,
) => audit.allowedMutations.filter((candidate) => candidate === procedure).length;

export const expectInvalidEmployeeInviteDetails = async ({
  page,
  audit,
  action,
}: {
  page: Page;
  audit: EmployeeInvitationAudit;
  action: () => Promise<void>;
}) => {
  const responses: Response[] = [];
  const onResponse = (response: Response) => {
    const request = response.request();
    if (
      request.method().toUpperCase() === "GET" &&
      readProcedures(new URL(response.url())).includes("publicAuth.inviteDetails")
    ) {
      responses.push(response);
    }
  };
  const consoleErrorStart = audit.consoleErrors.length;
  page.on("response", onResponse);
  try {
    await action();
    await expect.poll(() => responses.length).toBe(2);
  } finally {
    page.off("response", onResponse);
  }

  expect(
    responses.map((response) => ({ status: response.status(), statusText: response.statusText() })),
    "invalid invite details must return one initial and one retried 404",
  ).toEqual([
    { status: 404, statusText: "Not Found" },
    { status: 404, statusText: "Not Found" },
  ]);
  const consoleError =
    "Failed to load resource: the server responded with a status of 404 (Not Found)";
  await expect
    .poll(() => audit.consoleErrors.slice(consoleErrorStart))
    .toEqual([consoleError, consoleError]);
  audit.consoleErrors.splice(consoleErrorStart, 2);
};

export const assertCleanEmployeeInvitationAudit = (audit: EmployeeInvitationAudit) => {
  expect(audit.consoleErrors, "unexpected console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedLocalMutations, "unexpected local mutations").toEqual([]);
};

export const attachEmployeeInvitationAuditOnFailure = async (
  testInfo: TestInfo,
  audit: EmployeeInvitationAudit,
) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("employee-invitation-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

export { expect };

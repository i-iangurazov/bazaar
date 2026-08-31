import { expect, test as base, type Page, type Request, type TestInfo } from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export const authLifecycleMutationProcedures = [
  "publicAuth.resetPassword",
  "publicAuth.verifyEmail",
  "publicAuth.acceptInvite",
  "publicAuth.signup",
  "publicAuth.registerBusiness",
] as const;

export type AuthLifecycleMutationProcedure = (typeof authLifecycleMutationProcedures)[number];

export type AuthLifecycleAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  allowedMutations: Array<{ procedure: AuthLifecycleMutationProcedure; url: string }>;
  allowedLocaleWrites: string[];
  acknowledgedHttpErrors: Array<{
    procedure: AuthLifecycleMutationProcedure;
    status: number;
    statusText: string;
  }>;
  blockedLocalMutations: string[];
};

type AuthLifecycleFixtures = { authLifecycleAudit: AuthLifecycleAudit };
const allowedProcedures = new Set<string>(authLifecycleMutationProcedures);
const requestDescription = (request: Request) => `${request.method()} ${request.url()}`;

const readProcedures = (url: URL) =>
  url.pathname.startsWith("/api/trpc/")
    ? decodeURIComponent(url.pathname.slice("/api/trpc/".length))
        .split(",")
        .map((procedure) => procedure.trim())
        .filter(Boolean)
    : [];

export const test = base.extend<AuthLifecycleFixtures>({
  authLifecycleAudit: async ({ baseURL, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: AuthLifecycleAudit = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
      externalWebSockets: [],
      allowedMutations: [],
      allowedLocaleWrites: [],
      acknowledgedHttpErrors: [],
      blockedLocalMutations: [],
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
        audit.allowedLocaleWrites.push(request.url());
        await route.continue();
        return;
      }

      const procedures = readProcedures(url);
      if (
        method === "POST" &&
        procedures.length > 0 &&
        procedures.every((procedure) => allowedProcedures.has(procedure))
      ) {
        for (const procedure of procedures) {
          audit.allowedMutations.push({
            procedure: procedure as AuthLifecycleMutationProcedure,
            url: request.url(),
          });
        }
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
      webSocket.close({ code: 1008, reason: "Auth lifecycle E2E blocks external sockets" });
    });

    await provide(audit);
  },
});

export const mutationRequestCount = (
  audit: AuthLifecycleAudit,
  procedure: AuthLifecycleMutationProcedure,
) => audit.allowedMutations.filter((entry) => entry.procedure === procedure).length;

export const expectAuthLifecycleHttpError = async ({
  page,
  audit,
  procedure,
  status,
  action,
}: {
  page: Page;
  audit: AuthLifecycleAudit;
  procedure: AuthLifecycleMutationProcedure;
  status: number;
  action: () => Promise<void>;
}) => {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method().toUpperCase() !== "POST") return false;
    return readProcedures(new URL(response.url())).includes(procedure);
  });
  await action();
  const response = await responsePromise;
  expect(response.status(), `${procedure} negative-path HTTP status`).toBe(status);

  const consoleError = `Failed to load resource: the server responded with a status of ${status} (${response.statusText()})`;
  await expect
    .poll(() => audit.consoleErrors.filter((message) => message === consoleError).length)
    .toBe(1);
  const consoleIndex = audit.consoleErrors.indexOf(consoleError);
  audit.consoleErrors.splice(consoleIndex, 1);
  audit.acknowledgedHttpErrors.push({
    procedure,
    status,
    statusText: response.statusText(),
  });
};

export const assertCleanAuthLifecycleAudit = (audit: AuthLifecycleAudit) => {
  expect(audit.consoleErrors, "unexpected console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external sockets").toEqual([]);
  expect(audit.blockedLocalMutations, "unexpected local mutations").toEqual([]);
};

export const attachAuthLifecycleAuditOnFailure = async (
  testInfo: TestInfo,
  audit: AuthLifecycleAudit,
) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("auth-lifecycle-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

export { expect };

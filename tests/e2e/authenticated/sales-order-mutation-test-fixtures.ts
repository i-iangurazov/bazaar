import { expect, test as base, type Request, type TestInfo } from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export const salesOrderMutationProcedures = [
  "salesOrders.createDraft",
  "salesOrders.addLine",
  "salesOrders.removeLine",
  "salesOrders.confirm",
  "salesOrders.markReady",
  "salesOrders.complete",
] as const;

export type SalesOrderMutationProcedure = (typeof salesOrderMutationProcedures)[number];

export type SalesOrderMutationAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  navigationRequests: string[];
  allowedMutations: Array<{ procedure: SalesOrderMutationProcedure; url: string }>;
  blockedLocalMutations: string[];
};

type SalesOrderFixtures = { salesOrderAudit: SalesOrderMutationAudit };
const allowedProcedures = new Set<string>(salesOrderMutationProcedures);
const requestDescription = (request: Request) => `${request.method()} ${request.url()}`;

const readProcedures = (url: URL) =>
  url.pathname.startsWith("/api/trpc/")
    ? decodeURIComponent(url.pathname.slice("/api/trpc/".length))
        .split(",")
        .map((procedure) => procedure.trim())
        .filter(Boolean)
    : [];

export const test = base.extend<SalesOrderFixtures>({
  salesOrderAudit: async ({ baseURL, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: SalesOrderMutationAudit = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
      externalWebSockets: [],
      navigationRequests: [],
      allowedMutations: [],
      blockedLocalMutations: [],
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
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        await route.continue();
        return;
      }
      if (method === "POST" && url.pathname === "/api/help/events") {
        await route.fulfill({ status: 204, body: "" });
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
            procedure: procedure as SalesOrderMutationProcedure,
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
      webSocket.close({ code: 1008, reason: "Sales-order E2E blocks external sockets" });
    });

    await provide(audit);
  },
});

export { expect };

export const salesOrderMutationCount = (
  audit: SalesOrderMutationAudit,
  procedure: SalesOrderMutationProcedure,
) => audit.allowedMutations.filter((mutation) => mutation.procedure === procedure).length;

export const assertCleanSalesOrderAudit = (audit: SalesOrderMutationAudit) => {
  expect(audit.consoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedLocalMutations, "unexpected local mutation requests").toEqual([]);
};

export const attachSalesOrderAuditOnFailure = async (
  testInfo: TestInfo,
  audit: SalesOrderMutationAudit,
) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("sales-order-mutation-page-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

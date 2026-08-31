import { expect, test as base, type Request, type TestInfo } from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export const authenticatedMutationProcedures = [
  "products.create",
  "products.update",
  "inventory.adjust",
  "inventory.postStockReceiving",
  "inventory.transfer",
  "inventory.postStockWriteOff",
  "stockCounts.setLineCountedQty",
  "stockCounts.applyCount",
] as const;

export type AuthenticatedMutationProcedure = (typeof authenticatedMutationProcedures)[number];

export type MutationPageAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  navigationRequests: string[];
  allowedMutationRequests: Array<{
    method: string;
    procedures: AuthenticatedMutationProcedure[];
    url: string;
  }>;
  blockedLocalMutations: string[];
};

type MutationFixtures = {
  mutationAudit: MutationPageAudit;
};

const allowedMutationProcedures = new Set<string>(authenticatedMutationProcedures);
const requestDescription = (request: Request) => `${request.method()} ${request.url()}`;

const readTrpcProcedures = (url: URL) => {
  if (!url.pathname.startsWith("/api/trpc/")) return [];
  const encodedProcedures = url.pathname.slice("/api/trpc/".length);
  if (!encodedProcedures) return [];
  return decodeURIComponent(encodedProcedures)
    .split(",")
    .map((procedure) => procedure.trim())
    .filter(Boolean);
};

export const test = base.extend<MutationFixtures>({
  mutationAudit: async ({ baseURL, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: MutationPageAudit = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
      externalWebSockets: [],
      navigationRequests: [],
      allowedMutationRequests: [],
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

      const procedures = readTrpcProcedures(url);
      if (
        method === "POST" &&
        procedures.length > 0 &&
        procedures.every((procedure) => allowedMutationProcedures.has(procedure))
      ) {
        audit.allowedMutationRequests.push({
          method,
          procedures: procedures as AuthenticatedMutationProcedure[],
          url: request.url(),
        });
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
      webSocket.close({ code: 1008, reason: "Authenticated mutation E2E blocks external sockets" });
    });

    await provide(audit);
  },
});

export { expect };

export const mutationRequestCount = (
  audit: MutationPageAudit,
  procedure: AuthenticatedMutationProcedure,
) =>
  audit.allowedMutationRequests.reduce(
    (count, request) =>
      count + request.procedures.filter((requested) => requested === procedure).length,
    0,
  );

export const assertCleanMutationAudit = (audit: MutationPageAudit) => {
  expect(audit.consoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedLocalMutations, "unexpected local mutation requests").toEqual([]);
};

export const attachMutationAuditOnFailure = async (
  testInfo: TestInfo,
  audit: MutationPageAudit,
) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("authenticated-mutation-page-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

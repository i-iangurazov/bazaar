import { expect, test as base, type Request, type TestInfo } from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export const posMobileMutationProcedures = [
  "pos.sales.createDraft",
  "pos.sales.addLine",
  "pos.sales.updateLine",
  "pos.sales.updateCustomer",
  "pos.sales.updateDiscount",
  "pos.sales.complete",
] as const;
export type PosMobileMutationProcedure = (typeof posMobileMutationProcedures)[number];

export type PosMobileAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  allowedMutations: Array<{ procedure: PosMobileMutationProcedure; url: string }>;
  blockedLocalMutations: string[];
};

type PosMobileFixtures = { posMobileAudit: PosMobileAudit };
const allowedProcedures = new Set<string>(posMobileMutationProcedures);
const requestDescription = (request: Request) => `${request.method()} ${request.url()}`;

const readProcedures = (url: URL) =>
  url.pathname.startsWith("/api/trpc/")
    ? decodeURIComponent(url.pathname.slice("/api/trpc/".length))
        .split(",")
        .map((procedure) => procedure.trim())
        .filter(Boolean)
    : [];

export const test = base.extend<PosMobileFixtures>({
  posMobileAudit: async ({ baseURL, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: PosMobileAudit = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
      externalWebSockets: [],
      allowedMutations: [],
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

      const procedures = readProcedures(url);
      if (
        method === "POST" &&
        procedures.length > 0 &&
        procedures.every((procedure) => allowedProcedures.has(procedure))
      ) {
        for (const procedure of procedures) {
          audit.allowedMutations.push({
            procedure: procedure as PosMobileMutationProcedure,
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
      webSocket.close({ code: 1008, reason: "POS mobile E2E blocks external sockets" });
    });

    await provide(audit);
  },
});

export { expect };

export const posMobileMutationCount = (
  audit: PosMobileAudit,
  procedure: PosMobileMutationProcedure,
) => audit.allowedMutations.filter((mutation) => mutation.procedure === procedure).length;

export const assertCleanPosMobileAudit = (audit: PosMobileAudit) => {
  expect(audit.consoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedLocalMutations, "unexpected local mutation requests").toEqual([]);
};

export const attachPosMobileAuditOnFailure = async (testInfo: TestInfo, audit: PosMobileAudit) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("pos-mobile-page-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

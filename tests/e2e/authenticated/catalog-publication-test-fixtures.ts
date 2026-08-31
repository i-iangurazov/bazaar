import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export const catalogPublicationMutationProcedure = "bazaarCatalog.upsert" as const;

export type CatalogPublicationAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  blockedLocalMutations: string[];
  navigationRequests: string[];
  allowedMutationRequests: Array<{
    method: string;
    procedures: string[];
    url: string;
  }>;
};

type CatalogPublicationFixtures = {
  catalogPublicationAudit: CatalogPublicationAudit;
};

const requestDescription = (request: Request) => `${request.method()} ${request.url()}`;

const readTrpcProcedures = (url: URL) => {
  if (!url.pathname.startsWith("/api/trpc/")) return [];
  return decodeURIComponent(url.pathname.slice("/api/trpc/".length))
    .split(",")
    .map((procedure) => procedure.trim())
    .filter(Boolean);
};

export const test = base.extend<CatalogPublicationFixtures>({
  catalogPublicationAudit: async ({ baseURL, context, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: CatalogPublicationAudit = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
      externalWebSockets: [],
      blockedLocalMutations: [],
      navigationRequests: [],
      allowedMutationRequests: [],
    };

    const auditedPages = new WeakSet<Page>();
    const attachPageAudit = (targetPage: Page) => {
      if (auditedPages.has(targetPage)) return;
      auditedPages.add(targetPage);
      targetPage.on("console", (message: ConsoleMessage) => {
        if (message.type() === "error") audit.consoleErrors.push(message.text());
      });
      targetPage.on("pageerror", (error) => audit.pageErrors.push(error.message));
      targetPage.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === targetPage.mainFrame()) {
          audit.navigationRequests.push(request.url());
        }
      });
    };
    attachPageAudit(page);
    context.on("page", attachPageAudit);

    await context.route("**/*", async (route) => {
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
        procedures.every((procedure) => procedure === catalogPublicationMutationProcedure)
      ) {
        audit.allowedMutationRequests.push({ method, procedures, url: request.url() });
        await route.continue();
        return;
      }

      audit.blockedLocalMutations.push(requestDescription(request));
      await route.abort("blockedbyclient");
    });

    await context.routeWebSocket("**/*", async (webSocket) => {
      const url = new URL(webSocket.url());
      if (url.origin === localOrigin.replace(/^http/, "ws")) {
        webSocket.connectToServer();
        return;
      }
      audit.externalWebSockets.push(webSocket.url());
      webSocket.close({ code: 1008, reason: "Catalog-publication E2E blocks external sockets" });
    });

    await provide(audit);
    context.off("page", attachPageAudit);
  },
});

export { expect };

export const catalogPublicationMutationCount = (audit: CatalogPublicationAudit) =>
  audit.allowedMutationRequests.reduce(
    (count, request) =>
      count +
      request.procedures.filter((procedure) => procedure === catalogPublicationMutationProcedure)
        .length,
    0,
  );

export const assertCleanCatalogPublicationAudit = (
  audit: CatalogPublicationAudit,
  options: { expectedConsoleErrors?: readonly string[] } = {},
) => {
  expect(audit.consoleErrors, "unexpected browser console errors").toEqual(
    options.expectedConsoleErrors ?? [],
  );
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedLocalMutations, "unexpected local mutation requests").toEqual([]);
};

export const attachCatalogPublicationAuditOnFailure = async (
  testInfo: TestInfo,
  audit: CatalogPublicationAudit,
) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("catalog-publication-page-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

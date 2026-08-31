import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export const advancedProductMutationProcedures = [
  "products.create",
  "products.update",
  "bundles.assemble",
  "products.previewImportCsv",
  "customers.previewImport",
] as const;

export type AdvancedProductMutationProcedure = (typeof advancedProductMutationProcedures)[number];

export type AdvancedProductAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  navigationRequests: string[];
  allowedMutationRequests: Array<{
    method: string;
    procedures: AdvancedProductMutationProcedure[];
    url: string;
  }>;
  allowedUploadRequests: string[];
  blockedLocalMutations: string[];
};

type AdvancedProductFixtures = {
  advancedProductAudit: AdvancedProductAudit;
};

const allowedMutationProcedures = new Set<string>(advancedProductMutationProcedures);
const allowedUploadPaths = new Set([
  "/api/product-images/upload-url",
  "/api/product-images/upload",
]);
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

export const test = base.extend<AdvancedProductFixtures>({
  advancedProductAudit: async ({ baseURL, context, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: AdvancedProductAudit = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
      externalWebSockets: [],
      navigationRequests: [],
      allowedMutationRequests: [],
      allowedUploadRequests: [],
      blockedLocalMutations: [],
    };

    const attachedPages = new WeakSet<Page>();
    const attachPageAudit = (targetPage: Page) => {
      if (attachedPages.has(targetPage)) return;
      attachedPages.add(targetPage);
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
      if (method === "POST" && allowedUploadPaths.has(url.pathname)) {
        audit.allowedUploadRequests.push(requestDescription(request));
        await route.continue();
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
          procedures: procedures as AdvancedProductMutationProcedure[],
          url: request.url(),
        });
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
      webSocket.close({ code: 1008, reason: "Advanced-product E2E blocks external sockets" });
    });

    await provide(audit);
    context.off("page", attachPageAudit);
  },
});

export { expect };

export const mutationRequestCount = (
  audit: AdvancedProductAudit,
  procedure: AdvancedProductMutationProcedure,
) =>
  audit.allowedMutationRequests.reduce(
    (count, request) =>
      count + request.procedures.filter((requested) => requested === procedure).length,
    0,
  );

export const expectAdvancedProductHttpError = async ({
  page,
  audit,
  procedure,
  status,
  action,
}: {
  page: Page;
  audit: AdvancedProductAudit;
  procedure: AdvancedProductMutationProcedure;
  status: number;
  action: () => Promise<void>;
}) => {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method().toUpperCase() === "POST" &&
      readTrpcProcedures(new URL(response.url())).includes(procedure)
    );
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
};

export const assertCleanAdvancedProductAudit = (audit: AdvancedProductAudit) => {
  expect(audit.consoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedLocalMutations, "unexpected local mutation requests").toEqual([]);
};

export const attachAdvancedProductAuditOnFailure = async (
  testInfo: TestInfo,
  audit: AdvancedProductAudit,
) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("advanced-product-page-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

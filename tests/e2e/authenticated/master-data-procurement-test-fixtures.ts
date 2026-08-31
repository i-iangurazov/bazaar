import { expect, test as base, type Page, type Request, type TestInfo } from "@playwright/test";

import { assertAuthenticatedE2EBaseUrl } from "./contract";

export const masterDataProcurementMutationProcedures = [
  "products.create",
  "products.update",
  "productCategories.create",
  "productCategories.remove",
  "productCategories.setStoreVisibility",
  "units.create",
  "units.update",
  "units.remove",
  "attributes.create",
  "attributes.update",
  "attributes.remove",
  "suppliers.create",
  "suppliers.update",
  "purchaseOrders.create",
  "purchaseOrders.updateLine",
  "purchaseOrders.submit",
  "purchaseOrders.approve",
  "purchaseOrders.receive",
  "purchaseOrders.cancel",
] as const;

export type MasterDataProcurementMutationProcedure =
  (typeof masterDataProcurementMutationProcedures)[number];

export type MasterDataProcurementPageAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  navigationRequests: string[];
  allowedMutationRequests: Array<{
    method: string;
    procedures: MasterDataProcurementMutationProcedure[];
    url: string;
  }>;
  blockedLocalMutations: string[];
};

type MasterDataProcurementFixtures = {
  mutationAudit: MasterDataProcurementPageAudit;
};

const allowedMutationProcedures = new Set<string>(masterDataProcurementMutationProcedures);
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

export const test = base.extend<MasterDataProcurementFixtures>({
  mutationAudit: async ({ baseURL, page }, provide) => {
    const localOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const audit: MasterDataProcurementPageAudit = {
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
          procedures: procedures as MasterDataProcurementMutationProcedure[],
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
      webSocket.close({
        code: 1008,
        reason: "Master-data procurement E2E blocks external sockets",
      });
    });

    await provide(audit);
  },
});

export { expect };

export const mutationRequestCount = (
  audit: MasterDataProcurementPageAudit,
  procedure: MasterDataProcurementMutationProcedure,
) =>
  audit.allowedMutationRequests.reduce(
    (count, request) =>
      count + request.procedures.filter((requested) => requested === procedure).length,
    0,
  );

export const expectMasterDataProcurementHttpError = async ({
  page,
  audit,
  procedure,
  status,
  action,
}: {
  page: Page;
  audit: MasterDataProcurementPageAudit;
  procedure: MasterDataProcurementMutationProcedure;
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

export const assertCleanMutationAudit = (audit: MasterDataProcurementPageAudit) => {
  expect(audit.consoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.blockedLocalMutations, "unexpected local mutation requests").toEqual([]);
};

export const attachMutationAuditOnFailure = async (
  testInfo: TestInfo,
  audit: MasterDataProcurementPageAudit,
) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("master-data-procurement-page-audit", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
};

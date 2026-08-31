import { randomUUID } from "node:crypto";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import superjson, { type SuperJSONResult } from "superjson";

import {
  assertAuthenticatedE2EBaseUrl,
  assertAuthenticatedE2EDatabaseUrl,
  authenticatedE2EIds,
  authenticatedE2EStorageStatePath,
  type AuthenticatedE2EAccountKey,
} from "./contract";

type TrpcCall = { body: unknown; status: number; text: string };

type Profile = {
  email: string;
  jobTitle: string | null;
  name: string;
  phone: string | null;
};

type OnboardingProgress = {
  completedAt: Date | null;
  steps: Record<string, "completed" | "pending" | "skipped">;
};

type PageAudit = {
  consoleErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  pageErrors: string[];
  pendingResponseReads: Promise<void>[];
  responseBodies: string[];
  unexpectedMutations: string[];
};

let requestSequence = 0;

const asRecord = (value: unknown): Record<string, unknown> => {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
};

const nextRequestId = (path: string) => {
  requestSequence += 1;
  return `authenticated-operations-settings-${requestSequence}-${path.replace(/[^a-z0-9]+/gi, "-")}`;
};

const parseResponse = async (response: Awaited<ReturnType<APIRequestContext["get"]>>) => {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // Preserve a non-JSON error body for diagnostics.
  }
  return { body, status: response.status(), text } satisfies TrpcCall;
};

const trpcQuery = async (client: APIRequestContext, path: string, input?: unknown) => {
  const serializedInput = superjson.serialize(input as Parameters<typeof superjson.serialize>[0]);
  const batchInput = encodeURIComponent(JSON.stringify({ 0: serializedInput }));
  const response = await client.get(`/api/trpc/${path}?batch=1&input=${batchInput}`, {
    failOnStatusCode: false,
    headers: { "x-request-id": nextRequestId(path) },
  });
  return parseResponse(response);
};

const trpcMutation = async (client: APIRequestContext, path: string, input: unknown) => {
  const response = await client.post(`/api/trpc/${path}?batch=1`, {
    data: { 0: superjson.serialize(input as Parameters<typeof superjson.serialize>[0]) },
    failOnStatusCode: false,
    headers: {
      "content-type": "application/json",
      "x-request-id": nextRequestId(path),
    },
  });
  return parseResponse(response);
};

const firstBatchEntry = (call: TrpcCall) => {
  expect(Array.isArray(call.body), call.text).toBe(true);
  return asRecord((call.body as unknown[])[0]);
};

const expectTrpcSuccess = <T>(call: TrpcCall): T => {
  expect(call.status, call.text).toBe(200);
  const result = asRecord(firstBatchEntry(call).result);
  const data = asRecord(result.data) as unknown as SuperJSONResult;
  return superjson.deserialize<T>(data);
};

const expectTrpcError = (call: TrpcCall, code: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND") => {
  const error = asRecord(firstBatchEntry(call).error);
  const json = asRecord(error.json);
  const data = asRecord(json.data);
  expect(data.code, call.text).toBe(code);
  return json;
};

const collectForbiddenCredentialKeys = (value: unknown, keys: string[] = []) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectForbiddenCredentialKeys(item, keys));
    return keys;
  }
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      /^(?:apiToken|apiTokenEncrypted|password|passwordHash|clientSecret|privateKey)$/i.test(key)
    ) {
      keys.push(key);
    }
    collectForbiddenCredentialKeys(child, keys);
  }
  return keys;
};

const installPageAudit = async (
  page: Page,
  localOrigin: string,
  allowedMutationPaths: readonly string[] = [],
) => {
  const allowedMutations = new Set(allowedMutationPaths);
  const audit: PageAudit = {
    consoleErrors: [],
    externalRequests: [],
    externalWebSockets: [],
    pageErrors: [],
    pendingResponseReads: [],
    responseBodies: [],
    unexpectedMutations: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") audit.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => audit.pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== localOrigin || !url.pathname.startsWith("/api/trpc/")) return;
    audit.pendingResponseReads.push(
      response
        .text()
        .then((body) => {
          audit.responseBodies.push(body);
        })
        .catch(() => undefined),
    );
  });

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
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS" &&
      url.pathname !== "/api/help/events" &&
      !allowedMutations.has(url.pathname)
    ) {
      audit.unexpectedMutations.push(`${method} ${url.pathname}`);
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
    webSocket.close({ code: 1008, reason: "Operations acceptance blocks external sockets" });
  });
  return audit;
};

const expectAuditSafe = async (audit: PageAudit) => {
  await Promise.all(audit.pendingResponseReads);
  expect(audit.consoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected browser page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external browser requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external browser sockets").toEqual([]);
  expect(audit.unexpectedMutations, "unexpected local mutations").toEqual([]);
};

test.describe.configure({ mode: "serial" });

let baseOrigin = "";
const clients = new Map<AuthenticatedE2EAccountKey, APIRequestContext>();
const prisma = new PrismaClient({
  datasourceUrl: assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL),
});

test.beforeAll(async ({ baseURL }) => {
  baseOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
  for (const key of ["admin", "manager", "staff", "cashier"] as const) {
    clients.set(
      key,
      await playwrightRequest.newContext({
        baseURL: baseOrigin,
        ignoreHTTPSErrors: true,
        storageState: authenticatedE2EStorageStatePath(key),
      }),
    );
  }
});

test.afterAll(async () => {
  await Promise.all([...clients.values()].map((client) => client.dispose()));
  clients.clear();
  await prisma.$disconnect();
});

const clientFor = (key: "admin" | "manager" | "staff" | "cashier") => {
  const client = clients.get(key);
  if (!client) throw new Error(`Missing authenticated API client for ${key}.`);
  return client;
};

test("BZR-REQ-0185 profile mutation is reversible and rapid submit sends one request", async ({
  page,
}) => {
  const admin = clientFor("admin");
  const original = expectTrpcSuccess<Profile>(await trpcQuery(admin, "userSettings.getMyProfile"));
  const marker = `QA profile acceptance ${randomUUID()}`;
  const audit = await installPageAudit(page, baseOrigin, [
    "/api/trpc/userSettings.updateMyProfile",
  ]);
  let mutationRequests = 0;

  await page.route("**/api/trpc/userSettings.updateMyProfile**", async (route) => {
    mutationRequests += 1;
    const response = await route.fetch();
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 250));
    await route.fulfill({ response });
  });

  try {
    await page.goto("/settings/profile", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    const personalForm = page.locator("#account-settings form");
    await personalForm.getByLabel("Job", { exact: true }).fill(marker);
    await personalForm.evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
      (form as HTMLFormElement).requestSubmit();
    });

    await expect.poll(() => mutationRequests).toBe(1);
    await expect(page.getByText("Personal details saved.", { exact: true })).toBeVisible();
    const updated = expectTrpcSuccess<Profile>(await trpcQuery(admin, "userSettings.getMyProfile"));
    expect(updated.jobTitle).toBe(marker);
  } finally {
    expectTrpcSuccess<Profile>(
      await trpcMutation(admin, "userSettings.updateMyProfile", {
        jobTitle: original.jobTitle,
        name: original.name,
        phone: original.phone,
      }),
    );
  }

  expect(mutationRequests).toBe(1);
  await expectAuditSafe(audit);
});

test("BZR-REQ-0185 onboarding mutation is idempotent, useful, and admin-only", async ({ page }) => {
  const admin = clientFor("admin");
  const before = expectTrpcSuccess<OnboardingProgress>(await trpcQuery(admin, "onboarding.get"));
  expect(before.steps.store).toBe("completed");
  expectTrpcSuccess<OnboardingProgress>(
    await trpcMutation(admin, "onboarding.completeStep", { step: "store" }),
  );
  const after = expectTrpcSuccess<OnboardingProgress>(await trpcQuery(admin, "onboarding.get"));
  expect(after).toEqual(before);

  for (const role of ["manager", "staff"] as const) {
    const denied = await trpcMutation(clientFor(role), "onboarding.completeStep", {
      step: "store",
    });
    expect(denied.status).toBe(403);
    expectTrpcError(denied, "FORBIDDEN");
  }

  const audit = await installPageAudit(page, baseOrigin);
  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Quick start" })).toBeVisible();
  await expect(
    page.getByText(
      "Set up your store and complete the first operational workflow in about 30 minutes.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/^\d of 6 steps$/)).toBeVisible();
  await expect(
    page.getByText("Import a catalog or add at least three products manually.", { exact: true }),
  ).toBeVisible();
  await expectAuditSafe(audit);
});

test("BZR-REQ-0174/BZR-REQ-0175/BZR-REQ-0176/BZR-REQ-0177/BZR-REQ-0179 keeps integration setup safe and useful", async ({
  page,
}) => {
  const admin = clientFor("admin");
  const settingsPaths = ["mMarket.settings", "bakaiStore.settings", "oMarket.settings"] as const;
  const before = new Map<string, unknown>();
  for (const path of settingsPaths) {
    const settings = expectTrpcSuccess<unknown>(await trpcQuery(admin, path));
    before.set(path, settings);
    expect(collectForbiddenCredentialKeys(settings), `${path} exposed a credential`).toEqual([]);
  }

  const invalidCalls = [
    await trpcMutation(admin, "mMarket.saveConnection", {
      apiToken: "synthetic-not-saved",
      environment: "INVALID",
    }),
    await trpcMutation(admin, "bakaiStore.saveSettings", {
      apiToken: "synthetic-not-saved",
      connectionMode: "INVALID",
    }),
    await trpcMutation(admin, "oMarket.saveSettings", {
      apiToken: "x".repeat(4097),
    }),
  ];
  for (const call of invalidCalls) {
    expect(call.status).toBe(400);
    const error = expectTrpcError(call, "BAD_REQUEST");
    expect(JSON.stringify(error)).not.toContain("synthetic-not-saved");
  }
  for (const path of settingsPaths) {
    expect(expectTrpcSuccess<unknown>(await trpcQuery(admin, path))).toEqual(before.get(path));
  }

  const originalIntegration = await prisma.mMarketIntegration.findUnique({
    where: { orgId: authenticatedE2EIds.primaryOrganization },
  });
  const originalSettings = asRecord(before.get("mMarket.settings"));
  const originalSettingsIntegration = asRecord(originalSettings.integration);
  const environment = originalSettingsIntegration.environment === "PROD" ? "PROD" : "DEV";
  const syntheticToken = `qa-bazaar-disconnect-${randomUUID()}`;
  expect(originalSettingsIntegration.hasToken).toBe(false);
  expectTrpcSuccess<unknown>(
    await trpcMutation(admin, "mMarket.saveConnection", {
      environment,
      apiToken: syntheticToken,
    }),
  );

  try {
    const audit = await installPageAudit(page, baseOrigin, ["/api/trpc/mMarket.saveConnection"]);
    const observedTrpcPaths: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/trpc/")) observedTrpcPaths.push(url.pathname);
    });

    await page.goto("/operations/integrations", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
    await expect(
      page
        .getByText(
          "Open the integration to add credentials and complete the required store mappings.",
          { exact: true },
        )
        .first(),
    ).toBeVisible();

    await page.goto("/operations/integrations/m-market", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "bazaar + MMarket" })).toBeVisible();
    const tokenInput = page.locator('input[type="password"]').first();
    await expect(tokenInput).toHaveValue("");
    expect(observedTrpcPaths.some((path) => path.includes("mMarket.revealToken"))).toBe(false);

    const clearToken = page.getByRole("button", { name: "Clear token", exact: true });
    await expect(clearToken).toBeEnabled();
    await clearToken.click();
    let confirmDialog = page.getByRole("dialog", { name: "Confirm" });
    await expect(confirmDialog).toContainText(
      "Clearing the token disconnects M-Market exports until you save a new token. Store mappings and Bazaar data are kept.",
    );
    await expect(
      confirmDialog.getByRole("button", { name: "Clear token", exact: true }),
    ).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmDialog).toHaveCount(0);
    expect(
      observedTrpcPaths.filter((path) => path === "/api/trpc/mMarket.saveConnection"),
    ).toHaveLength(0);
    const settingsAfterCancel = expectTrpcSuccess<Record<string, unknown>>(
      await trpcQuery(admin, "mMarket.settings"),
    );
    expect(asRecord(settingsAfterCancel.integration).hasToken).toBe(true);

    await clearToken.click();
    confirmDialog = page.getByRole("dialog", { name: "Confirm" });
    await confirmDialog.getByRole("button", { name: "Clear token", exact: true }).click();
    await expect
      .poll(async () => {
        const settings = expectTrpcSuccess<Record<string, unknown>>(
          await trpcQuery(admin, "mMarket.settings"),
        );
        return asRecord(settings.integration).hasToken;
      })
      .toBe(false);
    expect(
      observedTrpcPaths.filter((path) => path === "/api/trpc/mMarket.saveConnection"),
    ).toHaveLength(1);

    await expectAuditSafe(audit);
    for (const body of audit.responseBodies) {
      expect(body).not.toContain("apiTokenEncrypted");
      expect(body).not.toContain(syntheticToken);
    }
  } finally {
    if (originalIntegration) {
      await prisma.mMarketIntegration.update({
        where: { orgId: authenticatedE2EIds.primaryOrganization },
        data: {
          status: originalIntegration.status,
          environment: originalIntegration.environment,
          apiTokenEncrypted: originalIntegration.apiTokenEncrypted,
          lastSyncAt: originalIntegration.lastSyncAt,
          lastSyncStatus: originalIntegration.lastSyncStatus,
          lastErrorSummary: originalIntegration.lastErrorSummary,
          updatedAt: originalIntegration.updatedAt,
        },
      });
    } else {
      await prisma.mMarketIntegration.deleteMany({
        where: { orgId: authenticatedE2EIds.primaryOrganization },
      });
    }
  }
});

test("BZR-REQ-0183/BZR-REQ-0184/BZR-REQ-0187 keeps compliance and hardware useful and correctly restricted", async ({
  page,
}) => {
  const admin = clientFor("admin");
  const manager = clientFor("manager");
  const staff = clientFor("staff");
  const cashier = clientFor("cashier");
  const storeId = authenticatedE2EIds.primaryStore;

  const compliance = expectTrpcSuccess<Record<string, unknown>>(
    await trpcQuery(admin, "compliance.getStore", { storeId }),
  );
  expectTrpcSuccess<Record<string, unknown>>(
    await trpcQuery(manager, "compliance.getStore", { storeId }),
  );
  const deniedComplianceRead = await trpcQuery(staff, "compliance.getStore", { storeId });
  expect(deniedComplianceRead.status).toBe(403);
  expectTrpcError(deniedComplianceRead, "FORBIDDEN");

  const deniedComplianceUpdate = await trpcMutation(manager, "compliance.updateStore", {
    storeId,
    defaultLocale: compliance.defaultLocale ?? null,
    enableEsf: compliance.enableEsf,
    enableEttn: compliance.enableEttn,
    enableKkm: compliance.enableKkm,
    enableMarking: compliance.enableMarking,
    kkmMode: compliance.kkmMode,
    kkmProviderKey: compliance.kkmProviderKey ?? null,
    kkmSettings: compliance.kkmSettings ?? null,
    markingMode: compliance.markingMode,
    taxRegime: compliance.taxRegime ?? null,
  });
  expect(deniedComplianceUpdate.status).toBe(403);
  expectTrpcError(deniedComplianceUpdate, "FORBIDDEN");

  const hardware = expectTrpcSuccess<{ settings: Record<string, unknown> }>(
    await trpcQuery(admin, "stores.hardware", { storeId }),
  );
  expectTrpcSuccess<unknown>(await trpcQuery(staff, "stores.hardware", { storeId }));
  expect(collectForbiddenCredentialKeys(hardware)).toEqual([]);
  const hardwareInput = {
    connectorDeviceId: `${storeId}_operations_acceptance_missing_device`,
    labelPrintMode: hardware.settings.labelPrintMode,
    receiptPrintMode: hardware.settings.receiptPrintMode,
    storeId,
  };
  const deniedHardwareUpdate = await trpcMutation(staff, "stores.updateHardware", hardwareInput);
  expect(deniedHardwareUpdate.status).toBe(403);
  expectTrpcError(deniedHardwareUpdate, "FORBIDDEN");
  const authorizedBoundary = await trpcMutation(cashier, "stores.updateHardware", hardwareInput);
  expect(authorizedBoundary.status).toBe(400);
  expectTrpcError(authorizedBoundary, "BAD_REQUEST");

  const audit = await installPageAudit(page, baseOrigin);
  await page.goto(`/stores/${storeId}/compliance`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Tax and compliance" })).toBeVisible();
  await expect(page.getByText("Cash register (KKM)", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kyrgyz Republic compliance guide" })).toBeVisible();

  await page.goto(`/stores/${storeId}/hardware`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Store hardware" })).toBeVisible();
  await expect(page.getByText("Default label profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Connector mode", { exact: true })).toBeVisible();
  await expectAuditSafe(audit);
});

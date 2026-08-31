import { randomUUID } from "node:crypto";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import superjson, { type SuperJSONResult } from "superjson";

import {
  assertAuthenticatedE2EBaseUrl,
  authenticatedE2EAccountKeys,
  authenticatedE2EAccounts,
  authenticatedE2EIds,
  authenticatedE2EStorageStatePath,
  type AuthenticatedE2EAccountKey,
} from "./contract";

type TrpcCall = {
  body: unknown;
  status: number;
  text: string;
};

type SupplierRecord = {
  email?: string | null;
  id: string;
  name: string;
  notes?: string | null;
  phone?: string | null;
};

type SupplierPage = {
  items: SupplierRecord[];
  page: number;
  pageSize: number;
  total: number;
};

type ProductRecord = {
  id: string;
  isDeleted: boolean;
  name: string;
  sku: string | null;
  updatedAt: Date;
};

type ProductPage = {
  items: ProductRecord[];
  page: number;
  pageSize: number;
  total: number;
};

type InventoryPage = {
  items: Array<{
    product: { id: string };
    snapshot: { id: string; productId: string; storeId: string };
  }>;
  total: number;
};

type SalesOrderPage = {
  items: Array<{ id: string; storeId: string }>;
  total: number;
};

type PosRegister = {
  id: string;
  storeId: string;
};

type ShrinkagePage = {
  items: Array<{
    documentId: string;
    productId: string;
    storeId: string;
  }>;
  total: number;
};

type BrowserAudit = {
  blockedSideEffects: string[];
  consoleErrors: string[];
  externalRequests: string[];
  externalWebSockets: string[];
  pageErrors: string[];
  pendingResponseReads: Promise<void>[];
  trpcResponseBodies: string[];
};

const sensitiveResponseKey =
  /^(?:password|passwordHash|sessionToken|accessToken|refreshToken|clientSecret|apiSecret|privateKey)$/i;
const accountEmails = Object.values(authenticatedE2EAccounts).map((account) => account.email);
let requestSequence = 0;

const asRecord = (value: unknown): Record<string, unknown> => {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
};

const responseJson = async (response: Awaited<ReturnType<APIRequestContext["get"]>>) => {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }
  return { body, status: response.status(), text } satisfies TrpcCall;
};

const nextRequestId = (path: string) => {
  requestSequence += 1;
  return `authenticated-rbac-isolation-${requestSequence}-${path.replace(/[^a-z0-9]+/gi, "-")}`;
};

const trpcQuery = async (
  client: APIRequestContext,
  path: string,
  input?: unknown,
): Promise<TrpcCall> => {
  const serializedInput = superjson.serialize(input as Parameters<typeof superjson.serialize>[0]);
  const batchInput = encodeURIComponent(JSON.stringify({ 0: serializedInput }));
  const response = await client.get(`/api/trpc/${path}?batch=1&input=${batchInput}`, {
    headers: { "x-request-id": nextRequestId(path) },
    failOnStatusCode: false,
  });
  return responseJson(response);
};

const trpcMutation = async (
  client: APIRequestContext,
  path: string,
  input: unknown,
): Promise<TrpcCall> => {
  const response = await client.post(`/api/trpc/${path}?batch=1`, {
    data: { 0: superjson.serialize(input as Parameters<typeof superjson.serialize>[0]) },
    headers: {
      "content-type": "application/json",
      "x-request-id": nextRequestId(path),
    },
    failOnStatusCode: false,
  });
  return responseJson(response);
};

const firstBatchEntry = (call: TrpcCall) => {
  expect(Array.isArray(call.body), `unexpected tRPC response: ${call.text}`).toBe(true);
  const entry = (call.body as unknown[])[0];
  return asRecord(entry);
};

const expectTrpcSuccess = <T>(call: TrpcCall): T => {
  expect(call.status, call.text).toBe(200);
  const result = asRecord(firstBatchEntry(call).result);
  const data = asRecord(result.data) as unknown as SuperJSONResult;
  return superjson.deserialize<T>(data);
};

const expectTrpcError = (
  call: TrpcCall,
  code: "FORBIDDEN" | "NOT_FOUND",
  allowedStatuses: readonly number[] = [code === "FORBIDDEN" ? 403 : 404],
) => {
  expect(allowedStatuses, call.text).toContain(call.status);
  const error = asRecord(firstBatchEntry(call).error);
  const errorJson = asRecord(error.json);
  const data = asRecord(errorJson.data);
  expect(data.code).toBe(code);
  expect(allowedStatuses).toContain(data.httpStatus);
  return errorJson;
};

const collectSensitiveKeys = (value: unknown, keys: string[] = []): string[] => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSensitiveKeys(item, keys));
    return keys;
  }
  if (!value || typeof value !== "object") return keys;
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (sensitiveResponseKey.test(key)) keys.push(key);
    collectSensitiveKeys(child, keys);
  });
  return keys;
};

const expectSafePayload = (value: unknown, excludedNeedles: readonly string[] = []) => {
  expect(collectSensitiveKeys(value), "sensitive response keys").toEqual([]);
  const serialized = JSON.stringify(value);
  for (const needle of [...excludedNeedles, ...accountEmails]) {
    expect(serialized).not.toContain(needle);
  }
};

const expectSafeFailure = (
  call: TrpcCall,
  code: "FORBIDDEN" | "NOT_FOUND",
  excludedNeedles: readonly string[],
) => {
  const error = expectTrpcError(call, code);
  expectSafePayload(error, excludedNeedles);
};

const supplierPage = async (client: APIRequestContext, search: string) =>
  expectTrpcSuccess<SupplierPage>(
    await trpcQuery(client, "suppliers.listPage", { search, page: 1, pageSize: 100 }),
  );

const findSupplier = async (client: APIRequestContext, id: string, search: string) => {
  const page = await supplierPage(client, search);
  return page.items.find((supplier) => supplier.id === id) ?? null;
};

const installAuditedReadOnlyPage = async (page: Page, localOrigin: string) => {
  const audit: BrowserAudit = {
    blockedSideEffects: [],
    consoleErrors: [],
    externalRequests: [],
    externalWebSockets: [],
    pageErrors: [],
    pendingResponseReads: [],
    trpcResponseBodies: [],
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
          audit.trpcResponseBodies.push(body);
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
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (method === "POST" && url.pathname === "/api/help/events") {
        await route.fulfill({ status: 204, body: "" });
        return;
      }
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
    webSocket.close({ code: 1008, reason: "RBAC acceptance blocks external sockets" });
  });
  return audit;
};

const expectBrowserAuditSafe = async (audit: BrowserAudit) => {
  await Promise.all(audit.pendingResponseReads);
  expect(audit.consoleErrors, "unexpected browser console errors").toEqual([]);
  expect(audit.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(audit.externalRequests, "unexpected external requests").toEqual([]);
  expect(audit.externalWebSockets, "unexpected external sockets").toEqual([]);
  expect(audit.blockedSideEffects, "unexpected page mutations").toEqual([]);
};

const attachEvidence = async (testInfo: TestInfo, name: string, value: unknown) => {
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
};

test.describe.configure({ mode: "serial" });

let baseOrigin = "";
const clients = new Map<AuthenticatedE2EAccountKey, APIRequestContext>();

test.beforeAll(async ({ baseURL }) => {
  baseOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
  for (const accountKey of authenticatedE2EAccountKeys) {
    clients.set(
      accountKey,
      await playwrightRequest.newContext({
        baseURL: baseOrigin,
        ignoreHTTPSErrors: true,
        storageState: authenticatedE2EStorageStatePath(accountKey),
      }),
    );
  }
});

test.afterAll(async () => {
  await Promise.all([...clients.values()].map((client) => client.dispose()));
  clients.clear();
});

const clientFor = (accountKey: AuthenticatedE2EAccountKey) => {
  const client = clients.get(accountKey);
  if (!client) throw new Error(`Missing authenticated API context for ${accountKey}.`);
  return client;
};

test("BZR-REQ-0106/BZR-REQ-0107 enforces in-page CRUD policy with a disposable positive lifecycle", async ({
  browser,
}, testInfo) => {
  const manager = clientFor("manager");
  const cleanupIds = new Set<string>();
  const unique = randomUUID();
  const createdName = `QA-BAZAAR RBAC Disposable ${unique}`;
  const updatedName = `QA-BAZAAR RBAC Updated ${unique}`;
  const deniedNames = {
    staff: `QA-BAZAAR RBAC STAFF Denied ${unique}`,
    cashier: `QA-BAZAAR RBAC CASHIER Denied ${unique}`,
  };
  const roleStatuses: Record<string, number> = {};

  try {
    for (const key of [
      "admin",
      "manager",
      "organizationOwner",
      "platformOwner",
      "secondTenantAdmin",
    ] as const) {
      const call = await trpcQuery(clientFor(key), "suppliers.listPage", {
        search: "QA-BAZAAR",
        page: 1,
        pageSize: 100,
      });
      roleStatuses[`${key}:read`] = call.status;
      const data = expectTrpcSuccess<SupplierPage>(call);
      expectSafePayload(
        data,
        key === "secondTenantAdmin"
          ? [authenticatedE2EIds.primarySupplier]
          : [authenticatedE2EIds.secondTenantSupplier],
      );
    }
    for (const key of ["staff", "cashier"] as const) {
      const call = await trpcQuery(clientFor(key), "suppliers.listPage", {
        search: "QA-BAZAAR",
        page: 1,
        pageSize: 100,
      });
      roleStatuses[`${key}:read`] = call.status;
      expectSafeFailure(call, "FORBIDDEN", [authenticatedE2EIds.primarySupplier]);
    }

    const createdCall = await trpcMutation(manager, "suppliers.create", {
      name: createdName,
      email: `rbac-${unique}@auth-e2e.test`,
      notes: "Dedicated production acceptance record; safe to delete.",
    });
    const created = expectTrpcSuccess<SupplierRecord>(createdCall);
    cleanupIds.add(created.id);
    expect(created.name).toBe(createdName);

    const updated = expectTrpcSuccess<SupplierRecord>(
      await trpcMutation(manager, "suppliers.update", {
        supplierId: created.id,
        name: updatedName,
        email: `rbac-${unique}@auth-e2e.test`,
        notes: "Dedicated production acceptance record; safe to delete.",
      }),
    );
    expect(updated).toMatchObject({ id: created.id, name: updatedName });
    expect(await findSupplier(manager, created.id, unique)).toMatchObject({
      id: created.id,
      name: updatedName,
    });

    expectTrpcSuccess<SupplierRecord>(
      await trpcMutation(manager, "suppliers.delete", { supplierId: created.id }),
    );
    cleanupIds.delete(created.id);
    expect((await supplierPage(manager, unique)).total).toBe(0);

    const primaryBefore = await findSupplier(
      manager,
      authenticatedE2EIds.primarySupplier,
      "QA-BAZAAR Primary Supplier",
    );
    expect(primaryBefore).not.toBeNull();

    for (const key of ["staff", "cashier"] as const) {
      const createCall = await trpcMutation(clientFor(key), "suppliers.create", {
        name: deniedNames[key],
        email: `${key}-${unique}@auth-e2e.test`,
      });
      roleStatuses[`${key}:create`] = createCall.status;
      if (createCall.status === 200) {
        const leaked = expectTrpcSuccess<SupplierRecord>(createCall);
        cleanupIds.add(leaked.id);
      }
      expectSafeFailure(createCall, "FORBIDDEN", [deniedNames[key]]);

      const nonexistentId = `qa_bazaar_auth_supplier_${key}_nonexistent_${unique}`;
      const updateCall = await trpcMutation(clientFor(key), "suppliers.update", {
        supplierId: nonexistentId,
        name: `QA-BAZAAR ${key} denied update`,
      });
      roleStatuses[`${key}:update`] = updateCall.status;
      expectSafeFailure(updateCall, "FORBIDDEN", [nonexistentId]);

      const deleteCall = await trpcMutation(clientFor(key), "suppliers.delete", {
        supplierId: nonexistentId,
      });
      roleStatuses[`${key}:delete`] = deleteCall.status;
      expectSafeFailure(deleteCall, "FORBIDDEN", [nonexistentId]);
    }

    const primaryAfter = await findSupplier(
      manager,
      authenticatedE2EIds.primarySupplier,
      "QA-BAZAAR Primary Supplier",
    );
    expect(primaryAfter).toEqual(primaryBefore);
    expect((await supplierPage(manager, unique)).total).toBe(0);

    const cashierContext = await browser.newContext({
      baseURL: baseOrigin,
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
      storageState: authenticatedE2EStorageStatePath("cashier"),
      viewport: { width: 1440, height: 900 },
    });
    try {
      const page = await cashierContext.newPage();
      const audit = await installAuditedReadOnlyPage(page, baseOrigin);
      await page.goto("/products", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
      const productSearch = page.getByRole("textbox", {
        name: "Search by name, SKU, or barcode",
        exact: true,
      });
      await productSearch.fill("QA-BAZAAR Authenticated Product");
      await expect(productSearch).toHaveValue("QA-BAZAAR Authenticated Product");
      await expect(
        page.getByRole("table").getByText("QA-BAZAAR Authenticated Product", { exact: true }),
      ).toBeVisible();
      await expect(page.locator('a[href^="/products/new"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New product", exact: true })).toHaveCount(0);
      await expectBrowserAuditSafe(audit);
      for (const body of audit.trpcResponseBodies) {
        expect(body).not.toContain(authenticatedE2EIds.secondTenantProduct);
        expect(body).not.toContain(authenticatedE2EIds.secondOrganization);
      }
    } finally {
      await cashierContext.close();
    }
  } finally {
    for (const supplierId of cleanupIds) {
      await trpcMutation(manager, "suppliers.delete", { supplierId });
    }
  }

  await attachEvidence(testInfo, "rbac-crud-role-statuses", roleStatuses);
});

test("BZR-REQ-0106/BZR-REQ-0107 completes product create, edit, archive, restore, and delete policy", async ({}, testInfo) => {
  const admin = clientFor("admin");
  const manager = clientFor("manager");
  const cleanupIds = new Set<string>();
  const unique = randomUUID();
  const sku = `QA-RBAC-${unique.slice(0, 12)}`;
  const createdName = `QA-BAZAAR RBAC Product ${unique}`;
  const updatedName = `QA-BAZAAR RBAC Product Updated ${unique}`;
  const statuses: Record<string, number> = {};

  try {
    const createdCall = await trpcMutation(manager, "products.create", {
      idempotencyKey: `rbac-product-create-${unique}`,
      sku,
      name: createdName,
      storeId: authenticatedE2EIds.primaryStore,
      baseUnitId: authenticatedE2EIds.primaryUnit,
      basePriceKgs: 125,
    });
    statuses["manager:create"] = createdCall.status;
    const created = expectTrpcSuccess<ProductRecord>(createdCall);
    cleanupIds.add(created.id);
    expect(created).toMatchObject({ name: createdName, sku });
    expect(created.updatedAt).toBeInstanceOf(Date);
    expectSafePayload(created, [authenticatedE2EIds.secondOrganization]);

    const updatedCall = await trpcMutation(manager, "products.update", {
      productId: created.id,
      expectedUpdatedAt: created.updatedAt,
      sku,
      name: updatedName,
      baseUnitId: authenticatedE2EIds.primaryUnit,
      basePriceKgs: 150,
    });
    statuses["manager:update"] = updatedCall.status;
    expect(expectTrpcSuccess<ProductRecord>(updatedCall)).toMatchObject({
      id: created.id,
      name: updatedName,
      sku,
    });

    const archivedCall = await trpcMutation(manager, "products.archive", {
      productId: created.id,
    });
    statuses["manager:archive"] = archivedCall.status;
    expect(expectTrpcSuccess<ProductRecord>(archivedCall)).toMatchObject({
      id: created.id,
      isDeleted: true,
    });

    const activeAfterArchive = expectTrpcSuccess<ProductPage>(
      await trpcQuery(manager, "products.list", {
        search: sku,
        page: 1,
        pageSize: 25,
      }),
    );
    expect(activeAfterArchive.items.map((product) => product.id)).not.toContain(created.id);
    const archivedProducts = expectTrpcSuccess<ProductPage>(
      await trpcQuery(manager, "products.list", {
        search: sku,
        includeArchived: true,
        page: 1,
        pageSize: 25,
      }),
    );
    expect(archivedProducts.items).toContainEqual(
      expect.objectContaining({ id: created.id, isDeleted: true, name: updatedName }),
    );
    expectSafePayload(archivedProducts, [
      authenticatedE2EIds.secondTenantProduct,
      authenticatedE2EIds.secondOrganization,
    ]);

    const restoredCall = await trpcMutation(manager, "products.restore", {
      productId: created.id,
    });
    statuses["manager:restore"] = restoredCall.status;
    expect(expectTrpcSuccess<ProductRecord>(restoredCall)).toMatchObject({
      id: created.id,
      isDeleted: false,
    });

    const managerDelete = await trpcMutation(manager, "products.deletePermanent", {
      productId: created.id,
    });
    statuses["manager:deletePermanent"] = managerDelete.status;
    expectSafeFailure(managerDelete, "FORBIDDEN", [created.id]);

    for (const key of ["staff", "cashier"] as const) {
      const deniedMarker = `qa_bazaar_auth_product_${key}_denied_${unique}`;
      const createCall = await trpcMutation(clientFor(key), "products.create", {
        idempotencyKey: `rbac-product-${key}-${unique}`,
        sku: `QA-${key.toUpperCase()}-${unique.slice(0, 8)}`,
        name: deniedMarker,
        storeId: authenticatedE2EIds.primaryStore,
        baseUnitId: authenticatedE2EIds.primaryUnit,
      });
      statuses[`${key}:create`] = createCall.status;
      if (createCall.status === 200) {
        cleanupIds.add(expectTrpcSuccess<ProductRecord>(createCall).id);
      }
      expectSafeFailure(createCall, "FORBIDDEN", [deniedMarker]);

      const archiveCall = await trpcMutation(clientFor(key), "products.archive", {
        productId: created.id,
      });
      statuses[`${key}:archive`] = archiveCall.status;
      expectSafeFailure(archiveCall, "FORBIDDEN", [created.id]);
    }

    const productAfterDeniedArchives = expectTrpcSuccess<Record<string, unknown> | null>(
      await trpcQuery(manager, "products.getById", { productId: created.id }),
    );
    expect(productAfterDeniedArchives).toMatchObject({ id: created.id, isDeleted: false });

    const deleteCall = await trpcMutation(admin, "products.deletePermanent", {
      productId: created.id,
    });
    statuses["admin:deletePermanent"] = deleteCall.status;
    expectTrpcSuccess<unknown>(deleteCall);
    cleanupIds.delete(created.id);
    expectTrpcSuccess<null>(await trpcQuery(admin, "products.getById", { productId: created.id }));
  } finally {
    for (const productId of cleanupIds) {
      await trpcMutation(admin, "products.deletePermanent", { productId });
    }
  }

  await attachEvidence(testInfo, "rbac-product-lifecycle-statuses", statuses);
});

test("BZR-REQ-0108 enforces export and print policy at the server boundary", async ({}, testInfo) => {
  const exportStatuses: Record<string, number> = {};
  const staffExport = await trpcQuery(clientFor("staff"), "products.exportCsv", {
    storeId: authenticatedE2EIds.primaryStore,
    columns: ["sku", "name"],
  });
  exportStatuses["staff:product-export"] = staffExport.status;
  expectSafeFailure(staffExport, "FORBIDDEN", [authenticatedE2EIds.primaryProduct]);

  const cashierExportCall = await trpcQuery(clientFor("cashier"), "products.exportCsv", {
    storeId: authenticatedE2EIds.primaryStore,
    columns: ["sku", "name"],
  });
  exportStatuses["cashier:product-export"] = cashierExportCall.status;
  const cashierCsv = expectTrpcSuccess<string>(cashierExportCall);
  expect(cashierCsv).toContain("QA-BAZAAR-AUTH-PRIMARY");
  expect(cashierCsv).not.toContain("QA-BAZAAR-AUTH-FOREIGN");

  const managerCustomerExport = expectTrpcSuccess<unknown[]>(
    await trpcQuery(clientFor("manager"), "customers.exportRows", {
      storeId: authenticatedE2EIds.primaryStore,
    }),
  );
  expect(JSON.stringify(managerCustomerExport)).toContain("QA-BAZAAR Authenticated Customer");
  for (const key of ["staff", "cashier"] as const) {
    const call = await trpcQuery(clientFor(key), "customers.exportRows", {
      storeId: authenticatedE2EIds.primaryStore,
    });
    exportStatuses[`${key}:customer-export`] = call.status;
    expectSafeFailure(call, "FORBIDDEN", [authenticatedE2EIds.primaryCustomer]);
  }

  const invalidLabelPayload = `rbac-no-data-read-${randomUUID()}`;
  for (const [key, expectedStatus] of [
    ["staff", 403],
    ["cashier", 400],
  ] as const) {
    const response = await clientFor(key).post("/api/price-tags/pdf", {
      data: invalidLabelPayload,
      headers: {
        "content-type": "application/json",
        "x-request-id": nextRequestId(`price-tags-${key}`),
      },
      failOnStatusCode: false,
    });
    exportStatuses[`${key}:price-tag-print`] = response.status();
    expect(response.status()).toBe(expectedStatus);
    expect(await response.text()).not.toContain(invalidLabelPayload);
  }

  for (const [key, purchaseOrderId] of [
    ["admin", authenticatedE2EIds.primaryPurchaseOrder],
    ["manager", authenticatedE2EIds.primaryPurchaseOrder],
    ["organizationOwner", authenticatedE2EIds.primaryPurchaseOrder],
    ["platformOwner", authenticatedE2EIds.primaryPurchaseOrder],
    ["secondTenantAdmin", authenticatedE2EIds.secondTenantPurchaseOrder],
  ] as const) {
    const response = await clientFor(key).get(`/api/purchase-orders/${purchaseOrderId}/pdf`, {
      headers: { "x-request-id": nextRequestId(`purchase-order-pdf-${key}`) },
      failOnStatusCode: false,
    });
    exportStatuses[`${key}:purchase-order-print`] = response.status();
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
  }
  for (const key of ["staff", "cashier"] as const) {
    const response = await clientFor(key).get(
      `/api/purchase-orders/${authenticatedE2EIds.primaryPurchaseOrder}/pdf`,
      {
        headers: { "x-request-id": nextRequestId(`purchase-order-pdf-${key}`) },
        failOnStatusCode: false,
      },
    );
    exportStatuses[`${key}:purchase-order-print`] = response.status();
    expect(response.status()).toBe(403);
    const body = await response.text();
    expect(body).not.toContain(authenticatedE2EIds.primaryPurchaseOrder);
    expectSafePayload(body);
  }

  await attachEvidence(testInfo, "rbac-export-print-statuses", exportStatuses);
});

test("BZR-REQ-0112 rejects legitimate cross-tenant reads and mutations without side effects", async ({}, testInfo) => {
  const primary = clientFor("admin");
  const second = clientFor("secondTenantAdmin");
  const primarySupplierBefore = await findSupplier(
    primary,
    authenticatedE2EIds.primarySupplier,
    "QA-BAZAAR Primary Supplier",
  );
  const secondSupplierBefore = await findSupplier(
    second,
    authenticatedE2EIds.secondTenantSupplier,
    "QA-BAZAAR Foreign Supplier",
  );
  expect(primarySupplierBefore).not.toBeNull();
  expect(secondSupplierBefore).not.toBeNull();

  const primaryOwnProduct = expectTrpcSuccess<Record<string, unknown> | null>(
    await trpcQuery(primary, "products.getById", {
      productId: authenticatedE2EIds.primaryProduct,
    }),
  );
  const primaryForeignProduct = expectTrpcSuccess<Record<string, unknown> | null>(
    await trpcQuery(primary, "products.getById", {
      productId: authenticatedE2EIds.secondTenantProduct,
    }),
  );
  const secondOwnProduct = expectTrpcSuccess<Record<string, unknown> | null>(
    await trpcQuery(second, "products.getById", {
      productId: authenticatedE2EIds.secondTenantProduct,
    }),
  );
  const secondForeignProduct = expectTrpcSuccess<Record<string, unknown> | null>(
    await trpcQuery(second, "products.getById", {
      productId: authenticatedE2EIds.primaryProduct,
    }),
  );
  expect(primaryOwnProduct).toMatchObject({ id: authenticatedE2EIds.primaryProduct });
  expect(primaryForeignProduct).toBeNull();
  expect(secondOwnProduct).toMatchObject({ id: authenticatedE2EIds.secondTenantProduct });
  expect(secondForeignProduct).toBeNull();
  expectSafePayload(primaryOwnProduct, [authenticatedE2EIds.secondOrganization]);
  expectSafePayload(secondOwnProduct, [authenticatedE2EIds.primaryOrganization]);

  for (const [client, foreignProductId] of [
    [primary, authenticatedE2EIds.secondTenantProduct],
    [second, authenticatedE2EIds.primaryProduct],
  ] as const) {
    const archiveCall = await trpcMutation(client, "products.archive", {
      productId: foreignProductId,
    });
    expectSafeFailure(archiveCall, "FORBIDDEN", [foreignProductId]);
  }
  const primaryProductAfterDeniedArchive = expectTrpcSuccess<Record<string, unknown> | null>(
    await trpcQuery(primary, "products.getById", {
      productId: authenticatedE2EIds.primaryProduct,
    }),
  );
  const secondProductAfterDeniedArchive = expectTrpcSuccess<Record<string, unknown> | null>(
    await trpcQuery(second, "products.getById", {
      productId: authenticatedE2EIds.secondTenantProduct,
    }),
  );
  expect(primaryProductAfterDeniedArchive).toMatchObject({ isDeleted: false });
  expect(secondProductAfterDeniedArchive).toMatchObject({ isDeleted: false });

  const mutationAttempts = [
    {
      client: primary,
      targetId: authenticatedE2EIds.secondTenantSupplier,
      targetName: "QA-BAZAAR Cross Tenant Primary Attempt",
    },
    {
      client: second,
      targetId: authenticatedE2EIds.primarySupplier,
      targetName: "QA-BAZAAR Cross Tenant Second Attempt",
    },
  ];
  const statuses: number[] = [];
  for (const attempt of mutationAttempts) {
    const updateCall = await trpcMutation(attempt.client, "suppliers.update", {
      supplierId: attempt.targetId,
      name: attempt.targetName,
    });
    statuses.push(updateCall.status);
    expectSafeFailure(updateCall, "NOT_FOUND", [attempt.targetId, attempt.targetName]);

    const deleteCall = await trpcMutation(attempt.client, "suppliers.delete", {
      supplierId: attempt.targetId,
    });
    statuses.push(deleteCall.status);
    expectSafeFailure(deleteCall, "NOT_FOUND", [attempt.targetId]);
  }

  expect(
    await findSupplier(primary, authenticatedE2EIds.primarySupplier, "QA-BAZAAR Primary Supplier"),
  ).toEqual(primarySupplierBefore);
  expect(
    await findSupplier(
      second,
      authenticatedE2EIds.secondTenantSupplier,
      "QA-BAZAAR Foreign Supplier",
    ),
  ).toEqual(secondSupplierBefore);

  for (const [client, foreignStoreId] of [
    [primary, authenticatedE2EIds.secondTenantStore],
    [second, authenticatedE2EIds.primaryStore],
  ] as const) {
    const exportCall = await trpcQuery(client, "customers.exportRows", {
      storeId: foreignStoreId,
    });
    expectSafeFailure(exportCall, "FORBIDDEN", [foreignStoreId]);
  }

  for (const [client, foreignPurchaseOrderId] of [
    [primary, authenticatedE2EIds.secondTenantPurchaseOrder],
    [second, authenticatedE2EIds.primaryPurchaseOrder],
  ] as const) {
    const response = await client.get(`/api/purchase-orders/${foreignPurchaseOrderId}/pdf`, {
      headers: { "x-request-id": nextRequestId("cross-tenant-purchase-order-pdf") },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(foreignPurchaseOrderId);
    expectSafePayload(body);
  }

  await attachEvidence(testInfo, "cross-tenant-mutation-statuses", statuses);
});

test("BZR-REQ-0115/BZR-REQ-0184 scopes search and export responses by role and tenant", async ({}, testInfo) => {
  const responses: Record<string, unknown> = {};
  const searchCases = [
    {
      key: "admin",
      query: "QA-BAZAAR-AUTH-PRIMARY",
      expectedProductIds: [authenticatedE2EIds.primaryProduct],
      excludedIds: [
        authenticatedE2EIds.secondTenantProduct,
        authenticatedE2EIds.secondOrganization,
      ],
    },
    {
      key: "cashier",
      query: "QA-BAZAAR-AUTH-PRIMARY",
      expectedProductIds: [authenticatedE2EIds.primaryProduct],
      excludedIds: [
        authenticatedE2EIds.secondTenantProduct,
        authenticatedE2EIds.secondOrganization,
      ],
    },
    {
      key: "staff",
      query: "QA-BAZAAR-AUTH-PRIMARY",
      expectedProductIds: [],
      excludedIds: [
        authenticatedE2EIds.secondTenantProduct,
        authenticatedE2EIds.secondOrganization,
      ],
    },
    {
      key: "secondTenantAdmin",
      query: "QA-BAZAAR-AUTH-FOREIGN",
      expectedProductIds: [authenticatedE2EIds.secondTenantProduct],
      excludedIds: [authenticatedE2EIds.primaryProduct, authenticatedE2EIds.primaryOrganization],
    },
  ] as const;
  for (const { key, query, expectedProductIds, excludedIds } of searchCases) {
    const call = await trpcQuery(clientFor(key), "search.global", { q: query });
    const data = expectTrpcSuccess<{ results: Array<{ id: string; type: string }> }>(call);
    responses[`${key}:search`] = { query, data };
    expectSafePayload(data, excludedIds);
    expect(data.results.map((result) => result.id)).toEqual(expectedProductIds);
    if (key === "cashier") {
      expect(data.results.every((result) => result.type === "product")).toBe(true);
    }
  }

  const primaryCsv = expectTrpcSuccess<string>(
    await trpcQuery(clientFor("manager"), "products.exportCsv", {
      storeId: authenticatedE2EIds.primaryStore,
      columns: ["sku", "name"],
    }),
  );
  const secondCsv = expectTrpcSuccess<string>(
    await trpcQuery(clientFor("secondTenantAdmin"), "products.exportCsv", {
      storeId: authenticatedE2EIds.secondTenantStore,
      columns: ["sku", "name"],
    }),
  );
  expect(primaryCsv).toContain("QA-BAZAAR-AUTH-PRIMARY");
  expect(primaryCsv).not.toContain("QA-BAZAAR-AUTH-FOREIGN");
  expect(secondCsv).toContain("QA-BAZAAR-AUTH-FOREIGN");
  expect(secondCsv).not.toContain("QA-BAZAAR-AUTH-PRIMARY");

  const crossStoreExport = await trpcQuery(clientFor("manager"), "products.exportCsv", {
    storeId: authenticatedE2EIds.secondTenantStore,
    columns: ["sku", "name"],
  });
  expectSafeFailure(crossStoreExport, "FORBIDDEN", [authenticatedE2EIds.secondTenantStore]);

  await attachEvidence(testInfo, "role-tenant-response-exposure", responses);
});

test("BZR-REQ-0113/BZR-REQ-0115/BZR-REQ-0186 scopes inventory, orders, POS, and reports by store", async ({}, testInfo) => {
  const manager = clientFor("manager");
  const secondTenantAdmin = clientFor("secondTenantAdmin");
  const statuses: Record<string, number> = {};
  const primaryExcludedIds = [
    authenticatedE2EIds.secondOrganization,
    authenticatedE2EIds.secondTenantStore,
    authenticatedE2EIds.secondTenantSecondaryStore,
    authenticatedE2EIds.secondTenantProduct,
    authenticatedE2EIds.secondTenantOrder,
    authenticatedE2EIds.foreignWriteOffReference,
  ];
  const secondTenantExcludedIds = [
    authenticatedE2EIds.primaryOrganization,
    authenticatedE2EIds.primaryStore,
    authenticatedE2EIds.secondaryStore,
    authenticatedE2EIds.primaryProduct,
    authenticatedE2EIds.primaryOrder,
    authenticatedE2EIds.writeOffReference,
  ];

  const primaryInventory = expectTrpcSuccess<InventoryPage>(
    await trpcQuery(manager, "inventory.list", {
      storeId: authenticatedE2EIds.primaryStore,
      page: 1,
      pageSize: 25,
    }),
  );
  const secondaryInventory = expectTrpcSuccess<InventoryPage>(
    await trpcQuery(manager, "inventory.list", {
      storeId: authenticatedE2EIds.secondaryStore,
      page: 1,
      pageSize: 25,
    }),
  );
  expect(primaryInventory.items.length).toBeGreaterThan(0);
  expect(secondaryInventory.items.length).toBeGreaterThan(0);
  expect(
    primaryInventory.items.every(
      (item) => item.snapshot.storeId === authenticatedE2EIds.primaryStore,
    ),
  ).toBe(true);
  expect(
    secondaryInventory.items.every(
      (item) => item.snapshot.storeId === authenticatedE2EIds.secondaryStore,
    ),
  ).toBe(true);
  expectSafePayload(primaryInventory, primaryExcludedIds);
  expectSafePayload(secondaryInventory, primaryExcludedIds);

  const primaryOrders = expectTrpcSuccess<SalesOrderPage>(
    await trpcQuery(manager, "salesOrders.list", {
      storeId: authenticatedE2EIds.primaryStore,
      page: 1,
      pageSize: 25,
    }),
  );
  const secondaryOrders = expectTrpcSuccess<SalesOrderPage>(
    await trpcQuery(manager, "salesOrders.list", {
      storeId: authenticatedE2EIds.secondaryStore,
      page: 1,
      pageSize: 25,
    }),
  );
  expect(primaryOrders.items.map((order) => order.id)).toContain(authenticatedE2EIds.primaryOrder);
  expect(
    primaryOrders.items.every((order) => order.storeId === authenticatedE2EIds.primaryStore),
  ).toBe(true);
  expect(secondaryOrders.items).toEqual([]);
  expectSafePayload(primaryOrders, primaryExcludedIds);
  expectSafePayload(secondaryOrders, primaryExcludedIds);

  const primaryRegisters = expectTrpcSuccess<PosRegister[]>(
    await trpcQuery(manager, "pos.registers.list", {
      storeId: authenticatedE2EIds.primaryStore,
    }),
  );
  const secondaryRegisters = expectTrpcSuccess<PosRegister[]>(
    await trpcQuery(manager, "pos.registers.list", {
      storeId: authenticatedE2EIds.secondaryStore,
    }),
  );
  expect(primaryRegisters).toContainEqual(
    expect.objectContaining({
      id: authenticatedE2EIds.primaryRegister,
      storeId: authenticatedE2EIds.primaryStore,
    }),
  );
  expect(secondaryRegisters).toContainEqual(
    expect.objectContaining({
      id: authenticatedE2EIds.secondaryRegister,
      storeId: authenticatedE2EIds.secondaryStore,
    }),
  );
  expectSafePayload(primaryRegisters, primaryExcludedIds);
  expectSafePayload(secondaryRegisters, primaryExcludedIds);

  const primaryShrinkage = expectTrpcSuccess<ShrinkagePage>(
    await trpcQuery(manager, "reports.shrinkage", {
      storeId: authenticatedE2EIds.primaryStore,
      dateFrom: "2026-08-31",
      dateTo: "2026-08-31",
      page: 1,
      pageSize: 25,
    }),
  );
  const secondaryShrinkage = expectTrpcSuccess<ShrinkagePage>(
    await trpcQuery(manager, "reports.shrinkage", {
      storeId: authenticatedE2EIds.secondaryStore,
      dateFrom: "2026-08-31",
      dateTo: "2026-08-31",
      page: 1,
      pageSize: 25,
    }),
  );
  expect(primaryShrinkage.items.map((row) => row.documentId)).toContain(
    authenticatedE2EIds.writeOffReference,
  );
  expect(
    primaryShrinkage.items.every((row) => row.storeId === authenticatedE2EIds.primaryStore),
  ).toBe(true);
  expect(secondaryShrinkage.items).toEqual([]);
  expectSafePayload(primaryShrinkage, primaryExcludedIds);
  expectSafePayload(secondaryShrinkage, primaryExcludedIds);

  const foreignInventory = expectTrpcSuccess<InventoryPage>(
    await trpcQuery(secondTenantAdmin, "inventory.list", {
      storeId: authenticatedE2EIds.secondTenantStore,
      page: 1,
      pageSize: 25,
    }),
  );
  const foreignOrders = expectTrpcSuccess<SalesOrderPage>(
    await trpcQuery(secondTenantAdmin, "salesOrders.list", {
      storeId: authenticatedE2EIds.secondTenantStore,
      page: 1,
      pageSize: 25,
    }),
  );
  const foreignShrinkage = expectTrpcSuccess<ShrinkagePage>(
    await trpcQuery(secondTenantAdmin, "reports.shrinkage", {
      storeId: authenticatedE2EIds.secondTenantStore,
      dateFrom: "2026-08-31",
      dateTo: "2026-08-31",
      page: 1,
      pageSize: 25,
    }),
  );
  expect(foreignInventory.items.map((item) => item.product.id)).toContain(
    authenticatedE2EIds.secondTenantProduct,
  );
  expect(foreignOrders.items.map((order) => order.id)).toContain(
    authenticatedE2EIds.secondTenantOrder,
  );
  expect(foreignShrinkage.items.map((row) => row.documentId)).toContain(
    authenticatedE2EIds.foreignWriteOffReference,
  );
  expectSafePayload(foreignInventory, secondTenantExcludedIds);
  expectSafePayload(foreignOrders, secondTenantExcludedIds);
  expectSafePayload(foreignShrinkage, secondTenantExcludedIds);

  const crossStoreCalls = [
    {
      key: "inventory",
      call: await trpcQuery(manager, "inventory.list", {
        storeId: authenticatedE2EIds.secondTenantStore,
        page: 1,
        pageSize: 25,
      }),
    },
    {
      key: "orders",
      call: await trpcQuery(manager, "salesOrders.list", {
        storeId: authenticatedE2EIds.secondTenantStore,
        page: 1,
        pageSize: 25,
      }),
    },
    {
      key: "pos",
      call: await trpcQuery(manager, "pos.registers.list", {
        storeId: authenticatedE2EIds.secondTenantStore,
      }),
    },
    {
      key: "reports",
      call: await trpcQuery(manager, "reports.shrinkage", {
        storeId: authenticatedE2EIds.secondTenantStore,
        dateFrom: "2026-08-31",
        dateTo: "2026-08-31",
        page: 1,
        pageSize: 25,
      }),
    },
  ];
  for (const { key, call } of crossStoreCalls) {
    statuses[`manager:${key}:foreign`] = call.status;
    expectSafeFailure(call, "FORBIDDEN", primaryExcludedIds);
  }

  await attachEvidence(testInfo, "store-boundary-statuses", statuses);
});

test("BZR-REQ-0113/BZR-REQ-0186 switches stores and keeps operational customer state separated", async ({
  browser,
}, testInfo) => {
  const manager = clientFor("manager");
  const primaryCustomers = expectTrpcSuccess<{ items: Array<{ id: string }> }>(
    await trpcQuery(manager, "customers.list", {
      storeId: authenticatedE2EIds.primaryStore,
      page: 1,
      pageSize: 25,
    }),
  );
  const secondaryCustomers = expectTrpcSuccess<{ items: Array<{ id: string }> }>(
    await trpcQuery(manager, "customers.list", {
      storeId: authenticatedE2EIds.secondaryStore,
      page: 1,
      pageSize: 25,
    }),
  );
  expect(primaryCustomers.items.map((customer) => customer.id)).toContain(
    authenticatedE2EIds.primaryCustomer,
  );
  expect(secondaryCustomers.items).toEqual([]);
  const foreignCustomers = await trpcQuery(manager, "customers.list", {
    storeId: authenticatedE2EIds.secondTenantStore,
    page: 1,
    pageSize: 25,
  });
  expectSafeFailure(foreignCustomers, "FORBIDDEN", [authenticatedE2EIds.secondTenantStore]);

  const context = await browser.newContext({
    baseURL: baseOrigin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    storageState: authenticatedE2EStorageStatePath("manager"),
    viewport: { width: 1440, height: 900 },
  });
  let audit: BrowserAudit | null = null;
  try {
    const page = await context.newPage();
    audit = await installAuditedReadOnlyPage(page, baseOrigin);
    await page.goto(`/customers?storeId=${authenticatedE2EIds.primaryStore}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1, name: "Customer Database" })).toBeVisible();
    const visiblePrimaryCustomer = page
      .getByText("QA-BAZAAR Authenticated Customer", { exact: true })
      .filter({ visible: true });
    await expect(visiblePrimaryCustomer).toHaveCount(1);

    await page.locator("#customer-store").click();
    await page.getByRole("option", { name: "QA-BAZAAR Secondary Store", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.secondaryStore);
    await expect(visiblePrimaryCustomer).toHaveCount(0);
    await expect(
      page.getByText(/This store has no customers yet/).filter({ visible: true }),
    ).toHaveCount(1);

    await page.locator("#customer-store").click();
    await page.getByRole("option", { name: "QA-BAZAAR Primary Store", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.primaryStore);
    await expect(visiblePrimaryCustomer).toHaveCount(1);
    await expectBrowserAuditSafe(audit);

    for (const body of audit.trpcResponseBodies) {
      expect(body).not.toContain(authenticatedE2EIds.secondTenantStore);
      expect(body).not.toContain(authenticatedE2EIds.secondTenantProduct);
      expect(body).not.toContain(authenticatedE2EIds.secondOrganization);
      for (const email of accountEmails) {
        if (email !== authenticatedE2EAccounts.manager.email) {
          expect(body).not.toContain(email);
        }
      }
    }
  } finally {
    await context.close();
  }

  await attachEvidence(testInfo, "store-separation-api-counts", {
    primary: primaryCustomers.items.length,
    secondary: secondaryCustomers.items.length,
    observedTrpcResponses: audit?.trpcResponseBodies.length ?? 0,
  });
});

test("BZR-REQ-0113/BZR-REQ-0186 keeps operational store switches isolated through refresh and history", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: baseOrigin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    storageState: authenticatedE2EStorageStatePath("manager"),
    viewport: { width: 1440, height: 900 },
  });
  let audit: BrowserAudit | null = null;
  const observedStates: Record<string, string> = {};

  try {
    const page = await context.newPage();
    audit = await installAuditedReadOnlyPage(page, baseOrigin);
    const chooseOption = async (trigger: ReturnType<Page["getByRole"]>, name: string) => {
      await trigger.click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    const roundTripThroughDashboard = async (expectedPath: string, expectedParam: string) => {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await page.goBack({ waitUntil: "domcontentloaded" });
      await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
      await expect.poll(() => new URL(page.url()).search).toContain(expectedParam);
    };

    await page.goto(
      `/inventory/movements?storeId=${authenticatedE2EIds.primaryStore}&audit=rbac-store`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { level: 1, name: "Product Movement" })).toBeVisible();
    const movementTable = page.getByRole("table");
    await expect(
      movementTable
        .locator("span:visible")
        .filter({ hasText: /^QA-BAZAAR Primary Store$/ })
        .first(),
    ).toBeVisible();
    await expect(movementTable.getByText("QA-BAZAAR Secondary Store", { exact: true })).toHaveCount(
      0,
    );
    const movementStore = page.getByRole("combobox", { name: "Store", exact: true });
    await chooseOption(movementStore, "QA-BAZAAR Secondary Store");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.secondaryStore);
    await expect(
      movementTable
        .locator("span:visible")
        .filter({ hasText: /^QA-BAZAAR Secondary Store$/ })
        .first(),
    ).toBeVisible();
    await expect(movementTable.getByText("QA-BAZAAR Primary Store", { exact: true })).toHaveCount(
      0,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.secondaryStore);
    await expect(
      page
        .getByRole("table")
        .locator("span:visible")
        .filter({ hasText: /^QA-BAZAAR Secondary Store$/ })
        .first(),
    ).toBeVisible();
    await roundTripThroughDashboard(
      "/inventory/movements",
      `storeId=${authenticatedE2EIds.secondaryStore}`,
    );
    observedStates.inventory = page.url();

    await page.goto(`/sales/orders?storeId=${authenticatedE2EIds.primaryStore}&audit=rbac-store`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1, name: "Customer orders" })).toBeVisible();
    await expect(page.getByRole("table").getByText("QA-BAZAAR-AUTH-ORDER-1")).toBeVisible();
    await chooseOption(page.getByRole("combobox", { name: "Store" }), "QA-BAZAAR Secondary Store");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.secondaryStore);
    await expect(page.getByText("No orders require action.", { exact: true })).toBeVisible();
    await expect(page.getByText("QA-BAZAAR-AUTH-ORDER-1")).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("No orders require action.", { exact: true })).toBeVisible();
    await roundTripThroughDashboard(
      "/sales/orders",
      `storeId=${authenticatedE2EIds.secondaryStore}`,
    );
    observedStates.orders = page.url();

    await page.goto(`/pos?registerId=${authenticatedE2EIds.primaryRegister}&audit=rbac-store`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1, name: "POS" })).toBeVisible();
    await expect(
      page
        .getByText(/QA-BAZAAR Primary Store · QA-BAZAAR Register/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await chooseOption(
      page.getByRole("combobox", { name: "Register" }).first(),
      "QA-BAZAAR Secondary Store · QA-BAZAAR Secondary Register (QA-AUTH-SECONDARY)",
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get("registerId"))
      .toBe(authenticatedE2EIds.secondaryRegister);
    await expect(
      page
        .getByText(/QA-BAZAAR Secondary Store · QA-BAZAAR Secondary Register/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText("Shift closed", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => new URL(page.url()).searchParams.get("registerId"))
      .toBe(authenticatedE2EIds.secondaryRegister);
    await expect(
      page
        .getByText(/QA-BAZAAR Secondary Store · QA-BAZAAR Secondary Register/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await roundTripThroughDashboard("/pos", `registerId=${authenticatedE2EIds.secondaryRegister}`);
    observedStates.pos = page.url();

    await page.goto(`/reports?storeId=${authenticatedE2EIds.primaryStore}&audit=rbac-store`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    const shrinkageCard = page
      .getByRole("heading", { level: 3, name: "Shrinkage" })
      .locator("../..");
    await expect(
      shrinkageCard.getByText("QA-BAZAAR Primary Store", { exact: true }).first(),
    ).toBeVisible();
    await chooseOption(
      page.getByRole("combobox", { name: "Select store" }),
      "QA-BAZAAR Secondary Store",
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.secondaryStore);
    expect(new URL(page.url()).searchParams.get("audit")).toBe("rbac-store");
    await expect(shrinkageCard.getByText("No shrinkage.", { exact: true })).toBeVisible();
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.primaryStore);
    await expect(
      shrinkageCard.getByText("QA-BAZAAR Primary Store", { exact: true }).first(),
    ).toBeVisible();
    await page.goForward({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.secondaryStore);
    await expect(shrinkageCard.getByText("No shrinkage.", { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => new URL(page.url()).searchParams.get("storeId"))
      .toBe(authenticatedE2EIds.secondaryStore);

    await page.goto(`/reports?audit=rbac-store&storeId=${authenticatedE2EIds.secondTenantStore}`, {
      waitUntil: "domcontentloaded",
    });
    await expect.poll(() => new URL(page.url()).searchParams.has("storeId")).toBe(false);
    expect(new URL(page.url()).searchParams.get("audit")).toBe("rbac-store");
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    observedStates.reports = page.url();

    await expectBrowserAuditSafe(audit);
    for (const body of audit.trpcResponseBodies) {
      const parsed = JSON.parse(body) as unknown;
      expect(collectSensitiveKeys(parsed), "sensitive browser response keys").toEqual([]);
      for (const needle of [
        authenticatedE2EIds.secondOrganization,
        authenticatedE2EIds.secondTenantStore,
        authenticatedE2EIds.secondTenantSecondaryStore,
        authenticatedE2EIds.secondTenantProduct,
        authenticatedE2EIds.secondTenantOrder,
        authenticatedE2EAccounts.secondTenantAdmin.email,
      ]) {
        expect(body).not.toContain(needle);
      }
    }
  } finally {
    await context.close();
  }

  await attachEvidence(testInfo, "durable-store-route-state", observedStates);
});

test("BZR-REQ-0115/BZR-REQ-0184 restricts platform and diagnostics data to the matching owner", async ({}, testInfo) => {
  const statuses: Record<string, number> = {};
  for (const key of [
    "admin",
    "manager",
    "staff",
    "cashier",
    "organizationOwner",
    "secondTenantAdmin",
  ] as const) {
    const call = await trpcQuery(clientFor(key), "platformOwner.summary");
    statuses[`${key}:platform`] = call.status;
    expectSafeFailure(call, "FORBIDDEN", [authenticatedE2EIds.primaryOrganization]);
  }
  const platformSummary = expectTrpcSuccess<Record<string, unknown>>(
    await trpcQuery(clientFor("platformOwner"), "platformOwner.summary"),
  );
  statuses["platformOwner:platform"] = 200;
  expectSafePayload(platformSummary);

  const organizations = expectTrpcSuccess<Array<Record<string, unknown>>>(
    await trpcQuery(clientFor("platformOwner"), "platformOwner.listOrganizations"),
  );
  expect(organizations.map((organization) => organization.id)).toEqual(
    expect.arrayContaining([
      authenticatedE2EIds.primaryOrganization,
      authenticatedE2EIds.secondOrganization,
    ]),
  );
  expectSafePayload(organizations);

  for (const key of ["organizationOwner", "platformOwner"] as const) {
    const call = await trpcQuery(clientFor(key), "diagnostics.getLastReport");
    statuses[`${key}:diagnostics`] = call.status;
    const data = expectTrpcSuccess<unknown>(call);
    expectSafePayload(
      data,
      key === "organizationOwner" ? [authenticatedE2EIds.secondOrganization] : [],
    );
  }
  for (const key of ["admin", "manager", "staff", "cashier", "secondTenantAdmin"] as const) {
    const call = await trpcQuery(clientFor(key), "diagnostics.getLastReport");
    statuses[`${key}:diagnostics`] = call.status;
    expectSafeFailure(call, "FORBIDDEN", [authenticatedE2EIds.primaryOrganization]);
  }

  await attachEvidence(testInfo, "owner-boundary-statuses", statuses);
});

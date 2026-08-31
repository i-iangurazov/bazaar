import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertAuthenticatedE2EBaseUrl,
  assertAuthenticatedE2EDatabaseUrl,
  assertAuthenticatedE2ERedisUrl,
  authenticatedE2EDatabaseName,
  authenticatedE2EIds,
  authenticatedE2ERedisKeyPrefix,
  authenticatedE2ESeedPrefix,
} from "../e2e/authenticated/contract";
import {
  authenticatedBaseRoles,
  authenticatedDynamicRoutes,
  authenticatedQueryStateRoutes,
  authenticatedRouteForms,
  canonicalAuthenticatedRoutes,
  expectedDeniedLocation,
  expectedLocationForAuthenticatedRoute,
} from "../e2e/authenticated/route-inventory";

const rootDir = process.cwd();
const readRequiredSource = (relativePath: string) => {
  const absolutePath = join(rootDir, relativePath);
  expect(existsSync(absolutePath), `${relativePath} must exist`).toBe(true);
  return readFileSync(absolutePath, "utf8");
};

const findRoute = (id: string) => {
  const route = authenticatedRouteForms.find((candidate) => candidate.id === id);
  expect(route, `missing authenticated route ${id}`).toBeDefined();
  return route!;
};

describe("authenticated Playwright route inventory", () => {
  it("keeps the authoritative 75 canonical patterns and six query-state forms separate", () => {
    expect(canonicalAuthenticatedRoutes).toHaveLength(75);
    expect(authenticatedQueryStateRoutes).toHaveLength(6);
    expect(authenticatedRouteForms).toHaveLength(81);
    expect(authenticatedBaseRoles).toEqual(["ADMIN", "MANAGER", "STAFF", "CASHIER"]);

    expect(new Set(canonicalAuthenticatedRoutes.map(({ id }) => id)).size).toBe(75);
    expect(new Set(authenticatedQueryStateRoutes.map(({ id }) => id)).size).toBe(6);
    expect(new Set(authenticatedRouteForms.map(({ id }) => id)).size).toBe(81);
    expect(new Set(authenticatedRouteForms.map(({ path }) => path)).size).toBe(81);
    expect(canonicalAuthenticatedRoutes.every(({ path }) => !path.includes("{id}"))).toBe(true);
    expect(
      authenticatedRouteForms.every(({ allowedRoles }) =>
        allowedRoles.every((role) => authenticatedBaseRoles.includes(role)),
      ),
    ).toBe(true);
  });

  it("models the role matrix and owner-only routes explicitly", () => {
    expect(findRoute("pos").allowedRoles).toEqual(authenticatedBaseRoles);
    expect(findRoute("product-detail").allowedRoles).toEqual(["ADMIN", "MANAGER", "CASHIER"]);
    expect(findRoute("products-new").allowedRoles).toEqual(["ADMIN", "MANAGER"]);
    expect(findRoute("dashboard").allowedRoles).toEqual(["ADMIN", "MANAGER"]);
    expect(findRoute("admin-jobs").allowedRoles).toEqual(["ADMIN"]);
    expect(findRoute("platform")).toMatchObject({
      allowedRoles: [],
      ownerRequirement: "platform",
    });
    expect(findRoute("settings-diagnostics")).toMatchObject({
      allowedRoles: [],
      ownerRequirement: "organization",
    });
    expect(findRoute("dev-scanner-test")).toMatchObject({
      allowedRoles: ["ADMIN"],
      productionOnlyNotFound: true,
    });
  });

  it("records every compatibility redirect as an exact final location", () => {
    expect(expectedLocationForAuthenticatedRoute(findRoute("orders-compatibility"))).toEqual({
      pathname: "/sales/orders",
    });
    expect(expectedLocationForAuthenticatedRoute(findRoute("customers-new-compatibility"))).toEqual(
      {
        pathname: "/customers",
        search: `?add=1&storeId=${authenticatedE2EIds.primaryStore}`,
      },
    );
    expect(expectedLocationForAuthenticatedRoute(findRoute("stores-new-compatibility"))).toEqual({
      pathname: "/stores",
    });
    expect(expectedLocationForAuthenticatedRoute(findRoute("suppliers-new-compatibility"))).toEqual(
      { pathname: "/suppliers" },
    );
    expect(
      expectedLocationForAuthenticatedRoute(findRoute("inventory-counts-new-compatibility")),
    ).toEqual({
      pathname: "/inventory/counts",
      search: `?page=1&pageSize=25&storeId=${authenticatedE2EIds.primaryStore}`,
    });
    expect(expectedLocationForAuthenticatedRoute(findRoute("cash-compatibility"))).toEqual({
      pathname: "/pos/shifts",
      hash: "#cash-movement",
    });
    expect(
      expectedLocationForAuthenticatedRoute(findRoute("finance-income-compatibility")),
    ).toEqual({
      pathname: "/pos/shifts",
      search: "?cashMovementType=PAY_IN",
      hash: "#cash-movement",
    });
    expect(
      expectedLocationForAuthenticatedRoute(findRoute("finance-expense-compatibility")),
    ).toEqual({
      pathname: "/pos/shifts",
      search: "?cashMovementType=PAY_OUT",
      hash: "#cash-movement",
    });
    for (const id of ["pos", "pos-debts", "pos-history", "pos-sell", "pos-shifts"] as const) {
      expect(expectedLocationForAuthenticatedRoute(findRoute(id))).toEqual({
        pathname: findRoute(id).path,
      });
    }
    expect(expectedLocationForAuthenticatedRoute(findRoute("inventory-receive-action"))).toEqual({
      pathname: "/inventory/receiving",
    });
    expect(expectedLocationForAuthenticatedRoute(findRoute("inventory-adjust-action"))).toEqual({
      pathname: "/inventory",
    });
    expect(expectedLocationForAuthenticatedRoute(findRoute("inventory-transfer-action"))).toEqual({
      pathname: "/inventory/transfers",
      search: `?fromStoreId=${authenticatedE2EIds.primaryStore}`,
    });
  });

  it("derives deterministic denial destinations without preserving a fragment", () => {
    expect(expectedDeniedLocation("ADMIN", "/products/new?type=bundle#ignored")).toEqual({
      pathname: "/dashboard",
      search: "?from=%2Fproducts%2Fnew%3Ftype%3Dbundle",
    });
    expect(expectedDeniedLocation("CASHIER", "/admin/jobs")).toEqual({
      pathname: "/pos",
      search: "?from=%2Fadmin%2Fjobs",
    });
  });

  it("covers exactly 11 dynamic patterns with owned, foreign, malformed, and missing cases", () => {
    expect(authenticatedDynamicRoutes).toHaveLength(11);
    expect(new Set(authenticatedDynamicRoutes.map(({ id }) => id)).size).toBe(11);
    expect(new Set(authenticatedDynamicRoutes.map(({ pattern }) => pattern)).size).toBe(11);
    expect(
      canonicalAuthenticatedRoutes.filter(({ pattern }) => pattern.includes("{id}")),
    ).toHaveLength(11);
    expect(authenticatedDynamicRoutes.map(({ pattern }) => pattern).sort()).toEqual(
      canonicalAuthenticatedRoutes
        .filter(({ pattern }) => pattern.includes("{id}"))
        .map(({ pattern }) => pattern)
        .sort(),
    );

    for (const routeCase of authenticatedDynamicRoutes) {
      expect(routeCase.pattern).toContain("{id}");
      expect(routeCase.validPath).not.toContain("{id}");
      expect(routeCase.foreignPath).not.toBe(routeCase.validPath);
      expect(routeCase.malformedPath).toContain("bad!id");
      expect(routeCase.missingPath).toContain("czzzzzzzzzzzzzzzzzzzzzzzz");
    }

    expect(findRoute("sales-order-detail").path).toContain(authenticatedE2EIds.primaryOrder);
    expect(findRoute("product-detail").path).toContain(authenticatedE2EIds.primaryProduct);
    expect(findRoute("inventory-count-detail").path).toContain(
      authenticatedE2EIds.primaryStockCount,
    );
    expect(findRoute("purchase-order-detail").path).toContain(
      authenticatedE2EIds.primaryPurchaseOrder,
    );
    expect(findRoute("store-compliance").path).toContain(authenticatedE2EIds.primaryStore);
  });
});

describe("authenticated E2E local-only guards", () => {
  const safeDatabaseUrl = `postgresql://qa_bazaar:local-only@127.0.0.1:5432/${authenticatedE2EDatabaseName}`;

  it("accepts only the dedicated loopback PostgreSQL database", () => {
    expect(assertAuthenticatedE2EDatabaseUrl(safeDatabaseUrl)).toContain(
      `/${authenticatedE2EDatabaseName}`,
    );
    expect(
      assertAuthenticatedE2EDatabaseUrl(
        `postgres://qa_bazaar:local-only@localhost:5432/${authenticatedE2EDatabaseName}`,
      ),
    ).toContain(`/${authenticatedE2EDatabaseName}`);

    expect(() => assertAuthenticatedE2EDatabaseUrl(undefined)).toThrow(
      "E2E_AUTH_DATABASE_URL is required",
    );
    expect(() => assertAuthenticatedE2EDatabaseUrl("not a URL")).toThrow(
      "must be a valid PostgreSQL URL",
    );
    expect(() =>
      assertAuthenticatedE2EDatabaseUrl(
        `https://qa_bazaar:local-only@127.0.0.1/${authenticatedE2EDatabaseName}`,
      ),
    ).toThrow("must use the PostgreSQL protocol");
    expect(() =>
      assertAuthenticatedE2EDatabaseUrl(
        `postgresql://qa_bazaar:local-only@db.example.test:5432/${authenticatedE2EDatabaseName}`,
      ),
    ).toThrow("restricted to a loopback PostgreSQL host");
    expect(() =>
      assertAuthenticatedE2EDatabaseUrl(
        "postgresql://qa_bazaar:local-only@127.0.0.1:5432/bazaar_production",
      ),
    ).toThrow(`may only use the ${authenticatedE2EDatabaseName} database`);
    expect(() =>
      assertAuthenticatedE2EDatabaseUrl(
        `postgresql://127.0.0.1:5432/${authenticatedE2EDatabaseName}`,
      ),
    ).toThrow("must include an explicit local database user");
  });

  it("accepts only loopback HTTP(S) application origins", () => {
    expect(assertAuthenticatedE2EBaseUrl("http://127.0.0.1:4174/path")).toBe(
      "http://127.0.0.1:4174",
    );
    expect(assertAuthenticatedE2EBaseUrl("https://127.0.0.1:4174/path")).toBe(
      "https://127.0.0.1:4174",
    );
    expect(() => assertAuthenticatedE2EBaseUrl("http://example.test:4174")).toThrow(
      "only target a local HTTP(S) server",
    );
  });

  it("accepts only loopback Redis for the production-mode browser runtime", () => {
    expect(assertAuthenticatedE2ERedisUrl("redis://127.0.0.1:56379/0")).toBe(
      "redis://127.0.0.1:56379/0",
    );
    expect(assertAuthenticatedE2ERedisUrl("rediss://localhost:56379/1")).toBe(
      "rediss://localhost:56379/1",
    );
    expect(() => assertAuthenticatedE2ERedisUrl(undefined)).toThrow(
      "E2E_AUTH_REDIS_URL is required",
    );
    expect(() => assertAuthenticatedE2ERedisUrl("not a URL")).toThrow("must be a valid Redis URL");
    expect(() => assertAuthenticatedE2ERedisUrl("http://127.0.0.1:56379")).toThrow(
      "must use the Redis protocol",
    );
    expect(() => assertAuthenticatedE2ERedisUrl("redis://cache.example.test:6379")).toThrow(
      "restricted to a loopback Redis host",
    );
    expect(authenticatedE2ERedisKeyPrefix).toBe("bazaar:test:authenticated-e2e:");
  });
});

describe("authenticated Playwright lane source safety", () => {
  it("keeps fixture writes gated, identity-checked, namespaced, and non-destructive", () => {
    const source = readRequiredSource("scripts/playwright-authenticated-fixture.ts");

    expect(source).toContain("ALLOW_AUTHENTICATED_E2E_SEED");
    expect(source).toContain("NODE_ENV");
    expect(source).toContain("E2E_AUTH_DATABASE_URL");
    expect(source).toContain("assertAuthenticatedE2EDatabaseUrl");
    expect(source).toContain("current_database()");
    expect(source).toContain("inet_server_addr()");
    expect(source).toMatch(/new\s+PrismaClient\s*\(/);
    expect(source).toMatch(/\$transaction\s*\(/);
    expect(source).toMatch(/\.upsert\s*\(/);
    expect(source).toContain("assertExtendedSeedOwnership");
    for (const protectedModel of [
      "customerOrderLine",
      "purchaseOrderLine",
      "stockCountLine",
      "posRegister",
      "registerShift",
      "storeComplianceProfile",
      "storePrinterSettings",
      "stockMovement",
    ]) {
      expect(source).toContain(`prisma.${protectedModel}.findMany`);
    }
    expect(source).toContain("authenticatedE2ESeedPrefix");
    expect(source).toContain("bcrypt");
    expect(source).toContain("inventoryValueDeltaKgs");
    expect(source).toContain("lineTotalKgs");
    expect(source).toContain('new Date("2026-08-31T06:00:00.000Z")');
    expect(authenticatedE2ESeedPrefix).toBe("QA-BAZAAR");
    expect(source).not.toMatch(/\.(?:delete|deleteMany)\s*\(/);
    expect(source).not.toMatch(/\b(?:TRUNCATE|DROP\s+(?:DATABASE|SCHEMA|TABLE))\b/i);
  });

  it("keeps the authenticated config isolated, deterministic, and local-only", () => {
    const source = readRequiredSource("playwright.authenticated.config.ts");

    expect(source).toContain("assertAuthenticatedE2EDatabaseUrl");
    expect(source).toContain("E2E_AUTH_DATABASE_URL");
    expect(source).toContain("E2E_AUTH_REDIS_URL");
    expect(source).toContain("assertAuthenticatedE2ERedisUrl");
    expect(source).toContain("authenticatedE2ERedisKeyPrefix");
    expect(source).toContain("ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION");
    expect(source).toContain("ALLOW_LOG_EMAIL_IN_PRODUCTION");
    expect(source).toMatch(/workers\s*:\s*1/);
    expect(source).toMatch(/serviceWorkers\s*:\s*["']block["']/);
    expect(source).toContain("1440");
    expect(source).toContain("1024");
    expect(source).toContain("390");
    expect(source).toMatch(/role-.*toLowerCase/);
    expect(source).toContain('["ADMIN", "admin"]');
    expect(source).toContain('["MANAGER", "manager"]');
    expect(source).toContain('["STAFF", "staff"]');
    expect(source).toContain('["CASHIER", "cashier"]');
    expect(source).toContain("owner-org");
    expect(source).toContain("owner-platform");
    expect(source).toContain('name: "authenticated-acceptance-admin"');
    expect(source).toContain('testMatch: "authenticated-acceptance-*.spec.ts"');
    expect(source).toContain("playwright-authenticated-network-guard.mjs");
    expect(source).toContain("AUTHENTICATED_E2E_EXPECT_PRODUCTION");
    expect(source).toContain("playwright-authenticated-production-server.mjs");
    expect(source).toContain("pnpm exec next dev");
    expect(source).toContain("ignoreHTTPSErrors: expectProduction");
    expect(source).toContain('NEXT_TELEMETRY_DISABLED: "1"');
    expect(source).toContain("--disable-background-networking");
    expect(source).toContain("--host-resolver-rules=MAP * ~NOTFOUND");
    expect(source).not.toContain("playwright-authenticated-fixture");
  });

  it("terminates secure production cookies through a loopback-only HTTPS proxy", () => {
    const source = readRequiredSource("scripts/playwright-authenticated-production-server.mjs");

    expect(source).toContain('const host = "127.0.0.1"');
    expect(source).toContain('"x-forwarded-proto": "https"');
    expect(source).toContain('"/usr/bin/openssl"');
    expect(source).toContain('"next", "start"');
    expect(source).toContain("test-results/authenticated/.tls");
    expect(source).toContain("AUTHENTICATED_E2E_PUBLIC_PORT");
    expect(source).toContain("AUTHENTICATED_E2E_INTERNAL_PORT");
    expect(source).toContain("withoutHopByHopHeaders(request.headers)");
    expect(source).toContain("withoutHopByHopHeaders(upstreamResponse.headers)");
    expect(source).toContain("rewriteInternalLocation(responseHeaders.location)");
    expect(source).toContain("const publicOrigin = `https://${host}:${publicPort}`");
    expect(source).toContain('"[::1]"');
    expect(source).toContain("target.port !== String(internalPort)");
    expect(source).toMatch(/agent\s*:\s*false/);
    expect(source).toContain('request.once("aborted", abortForwardedRequest)');
    expect(source).toContain('response.once("close"');
    expect(source).toContain("response.writableFinished");
    expect(source).toContain("proxy.closeAllConnections()");
    for (const header of [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ]) {
      expect(source).toContain(`"${header}"`);
    }
    expect(source).not.toMatch(/0\.0\.0\.0|listen\s*\(\s*publicPort\s*\)/);
  });

  it("blocks non-loopback fetch, HTTP, HTTPS, and TCP calls in the app process", () => {
    const source = readRequiredSource("scripts/playwright-authenticated-network-guard.mjs");

    expect(source).toContain("loopbackHosts");
    expect(source).toContain("E2E_EXTERNAL_NETWORK_BLOCKED");
    expect(source).toMatch(/http\.request\s*=/);
    expect(source).toMatch(/https\.request\s*=/);
    expect(source).toMatch(/net\.connect\s*=/);
    expect(source).toMatch(/globalThis\.fetch\s*=/);
  });

  it("uses NextAuth CSRF credentials flow and persists isolated storage states", () => {
    const source = readRequiredSource("tests/e2e/authenticated/auth.setup.ts");

    expect(source).toContain("/api/auth/csrf");
    expect(source).toContain("/api/auth/callback/credentials");
    expect(source).toContain("csrfToken");
    expect(source).toContain("/api/auth/session");
    expect(source).toContain("storageState");
    expect(source).toContain("assertAuthenticatedE2EBaseUrl");
  });

  it("blocks external traffic and unexpected local side effects while collecting page failures", () => {
    const source = readRequiredSource("tests/e2e/authenticated/test-fixtures.ts");

    expect(source).toContain('page.on("console"');
    expect(source).toContain('page.on("pageerror"');
    expect(source).toContain("page.route(");
    expect(source).toMatch(/routeWebSocket|websocket/i);
    expect(source).toMatch(/POST|GET|HEAD|OPTIONS/);
    expect(source).toMatch(/abort\s*\(/);
    expect(source).toMatch(/scrollWidth|overflow/i);
    expect(source).toMatch(/redirect/i);
  });

  it("drives role, owner, dynamic, and responsive matrices from the shared inventory", () => {
    const source = readRequiredSource("tests/e2e/authenticated/authenticated-routes.spec.ts");

    expect(source).toContain("authenticatedRouteForms");
    expect(source).toMatch(/authenticatedDynamicRoutes|authenticatedDynamicRouteCases/);
    expect(source).toContain("@role-matrix");
    expect(source).toContain("@owner-org");
    expect(source).toContain("@owner-platform");
    expect(source).toContain("@dynamic");
    expect(source).toContain("@responsive");
    expect(source).toMatch(/assertVisibleTerminalHeading|h1/i);
    expect(source).toMatch(/overflow/i);
    expect(source).toContain("assertProductionNotFoundPage");
    expect(source).toContain('name: "404"');
    expect(source).toContain("expect([200, 404]).toContain(response.status())");
  });

  it("keeps the transfer detail and print acceptance in its admin production project", () => {
    const source = readRequiredSource(
      "tests/e2e/authenticated/authenticated-acceptance-transfer.spec.ts",
    );

    expect(source).toContain("@inventory-transfer-balance");
    expect(source).toContain("assertTransferDetailLegs");
    expect(source).toContain("assertTransferPrintLegs");
    expect(source).toContain("data-movement-line-value");
    expect(source).toContain("page.reload");
  });
});

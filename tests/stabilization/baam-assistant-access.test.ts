import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SalesAnalytics from "@/server/services/salesAnalytics";

const mocks = vi.hoisted(() => ({ overview: vi.fn(), fetch: vi.fn() }));
vi.mock("@/server/services/salesAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof SalesAnalytics>()),
  getSalesAnalyticsOverview: mocks.overview,
}));
import { prisma } from "@/server/db/prisma";
import { baamRouter } from "@/server/trpc/routers/baam";
import {
  cleanupCommerceFixtures,
  commerceContext,
  createCommerceFixtures,
  type CommerceFixtures,
} from "./fixtures";

// Real PostgreSQL identities/roles/entitlements/grants and narrow tRPC router.
// The report projection and model transport are synthetic boundaries. No
// operational sales/inventory producer, customer data or live provider runs.
describe("BAAM assistant persisted authorization", () => {
  let fixture: CommerceFixtures;
  const request = {
    question: "Summarize sales",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-02",
    locale: "en" as const,
  };
  const providerResponse = () =>
    new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ intent: "summary", metrics: ["sales"], limitation: "none" }),
              },
            ],
          },
        ],
      }),
    );
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "synthetic-model-key");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(providerResponse());
    mocks.overview.mockResolvedValue({
      totals: {
        grossSalesKgs: 80,
        returnsKgs: 10,
        netSalesKgs: 70,
        discountKgs: 5,
        receiptCount: 2,
        returnCount: 1,
        averageReceiptKgs: 40,
        paymentBreakdown: { CASH: 80 },
        refundBreakdown: { CASH: 10 },
      },
      series: [],
    });
    fixture = await createCommerceFixtures(prisma);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (fixture) await cleanupCommerceFixtures(prisma, fixture);
  });
  const caller = (role: "ADMIN" | "MANAGER" | "STAFF" | "CASHIER") =>
    baamRouter.createCaller(commerceContext(prisma, fixture.tenants.a.users[role]));

  it("allows verified managers to ask with actual current grants and server-scoped evidence", async () => {
    const { a } = fixture.tenants;
    const result = await caller("MANAGER").ask(request);
    expect(result.answer).toContain("Sales before returns: 80 KGS");
    expect(result.evidence.storeNames).toEqual([a.stores[0].name]);
    expect(result.audience).toEqual({ actorId: a.users.MANAGER.id, organizationId: a.org.id });
    expect(mocks.overview).toHaveBeenCalledTimes(2);
    for (const [scope] of mocks.overview.mock.calls)
      expect(scope).toMatchObject({ organizationId: a.org.id, storeIds: [a.stores[0].id] });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("denies anonymous, STAFF and CASHIER callers before report/provider access", async () => {
    const anonymous = baamRouter.createCaller(commerceContext(prisma, null));
    await expect(anonymous.ask(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of ["STAFF", "CASHIER"] as const) {
      await expect(caller(role).ask(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role).capabilities()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("denies foreign and ungranted stores, ignoring cached manager privileges after downgrade", async () => {
    const { a, b } = fixture.tenants;
    const staleCaller = caller("MANAGER");
    for (const storeId of [b.stores[0].id, a.stores[1].id]) {
      await expect(staleCaller.ask({ ...request, storeId })).rejects.toThrow("storeAccessDenied");
    }
    await prisma.user.update({ where: { id: a.users.MANAGER.id }, data: { role: "STAFF" } });
    await expect(staleCaller.ask(request)).rejects.toThrow("forbidden");
    await expect(staleCaller.capabilities()).rejects.toThrow("forbidden");
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("discards an in-flight answer when the manager's stored grant is revoked", async () => {
    const { a } = fixture.tenants;
    mocks.fetch.mockImplementation(async () => {
      await prisma.userStoreAccess.deleteMany({
        where: { userId: a.users.MANAGER.id, storeId: a.stores[0].id, organizationId: a.org.id },
      });
      return providerResponse();
    });
    await expect(caller("MANAGER").ask(request)).rejects.toThrow("baamScopeChanged");
    expect(mocks.overview).toHaveBeenCalledTimes(2);
  });

  it("discards an in-flight answer when the actor is disabled", async () => {
    const { a } = fixture.tenants;
    mocks.fetch.mockImplementation(async () => {
      await prisma.user.update({ where: { id: a.users.MANAGER.id }, data: { isActive: false } });
      return providerResponse();
    });
    await expect(caller("MANAGER").ask(request)).rejects.toThrow("unauthorized");
    await expect(caller("MANAGER").capabilities()).rejects.toThrow("unauthorized");
  });

  it("rechecks actual entitlements and reports missing configuration without making a provider call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await caller("ADMIN").capabilities()).toMatchObject({
      available: false,
      reason: "not_configured",
    });
    await expect(caller("ADMIN").ask(request)).rejects.toThrow("baamNotConfigured");
    await prisma.organization.update({
      where: { id: fixture.tenants.a.org.id },
      data: { plan: "STARTER" },
    });
    await expect(caller("ADMIN").capabilities()).rejects.toThrow("featureLockedAnalytics");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

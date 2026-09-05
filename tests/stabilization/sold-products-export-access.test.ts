import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SalesAnalytics from "@/server/services/salesAnalytics";

const mocks = vi.hoisted(() => ({ export: vi.fn() }));
vi.mock("@/server/services/salesAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof SalesAnalytics>()), getSoldProductsAnalyticsExport: mocks.export,
}));
// The router's unrelated legacy exports are never loaded or invoked here.
vi.mock("@/server/services/analytics", () => ({
  getInventoryValue: vi.fn(), getSalesTrend: vi.fn(), getStockoutsLowStockSeries: vi.fn(), getTopProducts: vi.fn(),
}));
import { prisma } from "@/server/db/prisma";
import * as plans from "@/server/services/planLimits";
import { analyticsRouter } from "@/server/trpc/routers/analytics";
import { cleanupCommerceFixtures, commerceContext, createCommerceFixtures, type CommerceFixtures } from "./fixtures";

describe("all-filtered export current persisted permissions", () => {
  let fixture: CommerceFixtures;
  const request = { dateFrom:"2026-09-01", dateTo:"2026-09-02" };
  const caller = (role: "ADMIN" | "MANAGER" | "STAFF" | "CASHIER") => analyticsRouter.createCaller(commerceContext(prisma,fixture.tenants.a.users[role]));
  beforeEach(async () => {
    fixture = await createCommerceFixtures(prisma);
    mocks.export.mockReset();
    mocks.export.mockResolvedValue({ items:[],total:0,range:request,meta:{population:"all-filtered",rowLimit:10_000} });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (fixture) await cleanupCommerceFixtures(prisma,fixture);
  });

  it("passes the exact filters with only the live manager's granted store IDs", async () => {
    const {a} = fixture.tenants;
    await caller("MANAGER").soldProductsExport({...request,category:" Food ",search:" Tea ",cashierId:a.users.CASHIER.id});
    expect(mocks.export).toHaveBeenCalledTimes(1);
    expect(mocks.export).toHaveBeenCalledWith({
      organizationId:a.org.id,storeIds:[a.stores[0].id],registerId:undefined,cashierId:a.users.CASHIER.id,
      ...request,category:"Food",search:"Tea",
    });
    mocks.export.mockClear();
    await caller("ADMIN").soldProductsExport(request);
    expect(mocks.export.mock.calls[0][0].storeIds.sort()).toEqual(a.stores.map(store=>store.id).sort());
  });

  it("denies anonymous, lower-role, foreign-store, ungranted-store and foreign-cashier requests before reading rows", async () => {
    const {a,b} = fixture.tenants;
    await expect(analyticsRouter.createCaller(commerceContext(prisma,null)).soldProductsExport(request)).rejects.toMatchObject({code:"FORBIDDEN"});
    for (const role of ["STAFF","CASHIER"] as const) await expect(caller(role).soldProductsExport(request)).rejects.toThrow("forbidden");
    for (const storeId of [a.stores[1].id,b.stores[0].id]) await expect(caller("MANAGER").soldProductsExport({...request,storeId})).rejects.toThrow("storeAccessDenied");
    await expect(caller("MANAGER").soldProductsExport({...request,cashierId:b.users.CASHIER.id})).rejects.toThrow("userNotFound");
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it("validates a mocked reporting register's store without loading an operational register fixture", async () => {
    const {a} = fixture.tenants;
    const register = vi.spyOn(prisma.posRegister,"findFirst").mockResolvedValue({id:"reporting-register",storeId:a.stores[1].id} as never);
    await expect(caller("MANAGER").soldProductsExport({...request,registerId:"reporting-register"})).rejects.toThrow("storeAccessDenied");
    expect(register).toHaveBeenCalledWith(expect.objectContaining({where:{id:"reporting-register",organizationId:a.org.id}}));
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it("rejects stale roles, disabled actors, and an inactive or unentitled organization", async () => {
    const {a} = fixture.tenants;
    const stale = caller("MANAGER");
    await prisma.user.update({where:{id:a.users.MANAGER.id},data:{role:"STAFF"}});
    await expect(stale.soldProductsExport(request)).rejects.toThrow("forbidden");
    await prisma.user.update({where:{id:a.users.MANAGER.id},data:{role:"MANAGER",isActive:false}});
    await expect(stale.soldProductsExport(request)).rejects.toThrow("unauthorized");
    await prisma.organization.update({where:{id:a.org.id},data:{subscriptionStatus:"CANCELED"}});
    await expect(caller("ADMIN").soldProductsExport(request)).rejects.toThrow("subscriptionInactive");
    await prisma.organization.update({where:{id:a.org.id},data:{subscriptionStatus:"ACTIVE",plan:"STARTER"}});
    await expect(caller("ADMIN").soldProductsExport(request)).rejects.toThrow("featureLockedAnalytics");
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it("requires the exports feature independently from analytics", async () => {
    vi.spyOn(plans,"getPlanFeatures").mockReturnValue(["analytics"]);
    await expect(caller("ADMIN").soldProductsExport(request)).rejects.toThrow("featureLockedExports");
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it("discards an in-flight export when its store grant is revoked", async () => {
    const {a} = fixture.tenants;
    mocks.export.mockImplementation(async () => {
      await prisma.userStoreAccess.deleteMany({where:{organizationId:a.org.id,userId:a.users.MANAGER.id}});
      return {items:[{productName:"must not be delivered"}],total:1};
    });
    await expect(caller("MANAGER").soldProductsExport(request)).rejects.toThrow("analyticsExportScopeChanged");
  });

  it("rejects injected organization, store lists, row limits, and pagination inputs", async () => {
    for (const extra of [{organizationId:fixture.tenants.b.org.id},{storeIds:[fixture.tenants.b.stores[0].id]},{page:2},{pageSize:100},{limit:999999},{storeId:""},{registerId:""},{cashierId:""}]) {
      await expect(caller("ADMIN").soldProductsExport({...request,...extra} as typeof request)).rejects.toMatchObject({code:"BAD_REQUEST"});
    }
    expect(mocks.export).not.toHaveBeenCalled();
  });
});

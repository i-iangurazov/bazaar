import { describe, expect, it, vi } from "vitest";

import { forecastRouter } from "@/server/trpc/routers/forecast";
import type { Context } from "@/server/trpc/trpc";

function fixture(role: "ADMIN" | "MANAGER" | "STAFF" | "CASHIER" = "STAFF", owner = false) {
  const db = {
    store: { findFirst: vi.fn().mockResolvedValue({ id: "store" }) },
    userStoreAccess: { findFirst: vi.fn().mockResolvedValue({ id: "grant" }) },
    product: { findFirst: vi.fn().mockResolvedValue({ id: "product", organizationId: "org" }) },
    stockMovement: {
      findMany: vi.fn().mockResolvedValue([{ createdAt: new Date(), qtyDelta: -4 }]),
    },
  };
  const ctx = {
    prisma: db,
    user: {
      id: "actor",
      email: "fixture@example.invalid",
      organizationId: "org",
      role,
      isOrgOwner: owner,
      isPlatformOwner: false,
    },
    requestId: "forecast-regression",
    logger: { warn: vi.fn(), info: vi.fn() },
  } as unknown as Context;
  return { db, ctx, caller: forecastRouter.createCaller(ctx) };
}
const input = { storeId: "store", productId: "product", windowDays: 7 };

describe("forecast store authorization", () => {
  it.each(["MANAGER", "STAFF", "CASHIER"] as const)(
    "rejects %s without a store grant before reading business data",
    async (role) => {
      const f = fixture(role);
      f.db.userStoreAccess.findFirst.mockResolvedValueOnce(null);
      await expect(f.caller.explain(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "storeAccessDenied",
      });
      expect(f.db.product.findFirst).not.toHaveBeenCalled();
      expect(f.db.stockMovement.findMany).not.toHaveBeenCalled();
      expect(f.db.userStoreAccess.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "actor",
          organizationId: "org",
          storeId: "store",
          store: { organizationId: "org" },
        },
        select: { id: true },
      });
    },
  );

  it.each(["ADMIN", "MANAGER", "STAFF", "CASHIER"] as const)(
    "preserves authorized %s reads",
    async (role) => {
      const f = fixture(role);
      const result = await f.caller.explain(input);
      expect(result.dailySales.reduce((sum, day) => sum + day.qty, 0)).toBe(4);
      expect(f.db.stockMovement.findMany).toHaveBeenCalledOnce();
    },
  );

  it("rechecks a removed grant on the next request", async () => {
    const f = fixture();
    await f.caller.explain(input);
    f.db.userStoreAccess.findFirst.mockResolvedValueOnce(null);
    await expect(f.caller.explain(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.db.stockMovement.findMany).toHaveBeenCalledOnce();
  });

  it("keeps owner access while preventing an admin from reading a foreign store", async () => {
    const owner = fixture("MANAGER", true);
    await expect(owner.caller.explain(input)).resolves.toHaveProperty("dailySales");
    expect(owner.db.userStoreAccess.findFirst).not.toHaveBeenCalled();
    const admin = fixture("ADMIN");
    admin.db.store.findFirst.mockResolvedValueOnce(null);
    await expect(admin.caller.explain(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "storeAccessDenied",
    });
    expect(admin.db.product.findFirst).not.toHaveBeenCalled();
    expect(admin.db.stockMovement.findMany).not.toHaveBeenCalled();
  });

  it("rejects a missing or foreign-organization product before reading movements", async () => {
    const f = fixture();
    f.db.product.findFirst.mockResolvedValueOnce(null);
    await expect(f.caller.explain(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "productAccessDenied",
    });
    expect(f.db.product.findFirst).toHaveBeenCalledWith({
      where: { id: "product", organizationId: "org" },
      select: { id: true, organizationId: true },
    });
    expect(f.db.stockMovement.findMany).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers", async () => {
    const f = fixture();
    await expect(
      forecastRouter.createCaller({ ...f.ctx, user: null }).explain(input),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.db.stockMovement.findMany).not.toHaveBeenCalled();
  });
});

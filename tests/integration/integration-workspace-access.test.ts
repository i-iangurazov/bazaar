import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("integration workspace existing server permissions", () => {
  beforeEach(resetDatabase);

  it.each(["staffUser", "cashierUser"] as const)(
    "denies %s before creating integration state or issuing keys",
    async (role) => {
      const f = await seedBase({ plan: "ENTERPRISE" });
      const caller = createTestCaller({ ...f[role], organizationId: f.org.id });
      const reads = [
        () => caller.bazaarApi.listStores(),
        () => caller.bazaarCatalog.listStores(),
        () => caller.mMarket.settings(),
        () => caller.bakaiStore.settings(),
        () => caller.oMarket.settings(),
        () => caller.productImageStudio.overview(),
        () => caller.emailMarketing.overview({ storeId: f.store.id }),
      ];
      for (const read of reads) await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.bazaarApi.createApiKey({ storeId: f.store.id, name: "Forbidden key" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const counts = await Promise.all([
        prisma.bazaarApiKey.count({ where: { organizationId: f.org.id } }),
        prisma.bazaarCatalog.count({ where: { organizationId: f.org.id } }),
        prisma.mMarketIntegration.count({ where: { orgId: f.org.id } }),
        prisma.bakaiStoreIntegration.count({ where: { orgId: f.org.id } }),
        prisma.oMarketIntegration.count({ where: { orgId: f.org.id } }),
        prisma.productImageStudioJob.count({ where: { organizationId: f.org.id } }),
        prisma.emailCampaign.count({ where: { organizationId: f.org.id } }),
      ]);
      expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0]);
    },
  );

  it("retains manager reads for an assigned store without issuing keys or launching jobs", async () => {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const caller = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    expect((await caller.bazaarApi.listStores()).map((store) => store.storeId)).toContain(
      f.store.id,
    );
    expect((await caller.bazaarCatalog.listStores()).map((store) => store.storeId)).toContain(
      f.store.id,
    );
    await expect(caller.mMarket.settings()).resolves.toBeTruthy();
    await expect(caller.bakaiStore.settings()).resolves.toBeTruthy();
    await expect(caller.oMarket.settings()).resolves.toBeTruthy();
    await expect(caller.productImageStudio.overview()).resolves.toMatchObject({ totalJobs: 0 });
    await expect(caller.emailMarketing.overview({ storeId: f.store.id })).resolves.toHaveProperty(
      "reachableCustomers",
    );
    expect(await prisma.bazaarApiKey.count()).toBe(0);
    expect(await prisma.productImageStudioJob.count()).toBe(0);
    expect(await prisma.emailCampaign.count()).toBe(0);
  });
});

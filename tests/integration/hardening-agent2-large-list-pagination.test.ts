import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("HARD-A2-014 bounded history lists", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("paginates stock counts in stable order within the authorized store", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const baseTime = Date.UTC(2026, 7, 1, 0, 0, 0);
    await prisma.stockCount.createMany({
      data: Array.from({ length: 61 }, (_, index) => ({
        organizationId: org.id,
        storeId: store.id,
        code: `SC-${String(index).padStart(3, "0")}`,
        createdById: adminUser.id,
        createdAt: new Date(baseTime + index * 1_000),
        updatedAt: new Date(baseTime + index * 1_000),
      })),
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const page = await caller.stockCounts.list({ storeId: store.id, page: 2, pageSize: 10 });

    expect(page).toMatchObject({ total: 61, page: 2, pageSize: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.items.map((item) => item.code)).toEqual(
      Array.from({ length: 10 }, (_, offset) => `SC-${String(50 - offset).padStart(3, "0")}`),
    );
  });

  it("paginates only the requested import type and never transfers other organizations", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const otherOrg = await prisma.organization.create({ data: { name: "Other import org" } });
    const baseTime = Date.UTC(2026, 7, 2, 0, 0, 0);
    await prisma.importBatch.createMany({
      data: [
        ...Array.from({ length: 63 }, (_, index) => ({
          id: randomUUID(),
          organizationId: org.id,
          type: "products",
          createdById: adminUser.id,
          createdAt: new Date(baseTime + index * 1_000),
          summary: { rows: index + 1 },
        })),
        ...Array.from({ length: 7 }, (_, index) => ({
          id: randomUUID(),
          organizationId: org.id,
          type: "customers",
          createdById: adminUser.id,
          createdAt: new Date(baseTime + index * 1_000),
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          id: randomUUID(),
          organizationId: otherOrg.id,
          type: "products",
          createdAt: new Date(baseTime + index * 1_000),
        })),
      ],
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const page = await caller.imports.list({ type: "products", page: 3, pageSize: 20 });
    const lastPage = await caller.imports.list({ type: "products", page: 4, pageSize: 20 });

    expect(page).toMatchObject({ total: 63, page: 3, pageSize: 20 });
    expect(page.items).toHaveLength(20);
    expect(page.items.every((item) => item.organizationId === org.id && item.type === "products"))
      .toBe(true);
    expect(lastPage.items).toHaveLength(3);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
}));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: () => mockGetServerAuthToken(),
}));

import { GET } from "@/app/api/sse/route";
import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("B1 Agent 4 SSE store-isolation contract", () => {
  beforeEach(async () => {
    mockGetServerAuthToken.mockReset();
    await resetDatabase();
  });

  it("A4-005: assigned-store cashier receives only events from an allowed store", async () => {
    const { org, store, cashierUser } = await seedBase({ plan: "BUSINESS" });
    const unassignedStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Unassigned Realtime Store",
        code: "SSE-UNASSIGNED",
      },
    });
    mockGetServerAuthToken.mockResolvedValue({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
      isPlatformOwner: false,
    });
    const abortController = new AbortController();
    const response = await GET(
      new Request("http://localhost/api/sse", {
        signal: abortController.signal,
      }),
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("SSE response has no readable body");
    }

    try {
      eventBus.publish({
        type: "inventory.updated",
        payload: {
          storeId: unassignedStore.id,
          productId: "cross-store-product",
        },
      });
      const otherOrg = await prisma.organization.create({ data: { name: "SSE Other Org" } });
      const otherStore = await prisma.store.create({
        data: { organizationId: otherOrg.id, name: "Other Realtime Store", code: "SSE-OTHER" },
      });
      eventBus.publish({
        type: "inventory.updated",
        payload: { storeId: otherStore.id, productId: "cross-org-product" },
      });
      eventBus.publish({
        type: "sale.completed",
        payload: {
          storeId: unassignedStore.id,
          saleId: "cross-store-sale",
          number: "SSE-DENIED-001",
        },
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      eventBus.publish({
        type: "inventory.updated",
        payload: { storeId: store.id, productId: "allowed-product" },
      });

      const firstChunk = await reader.read();
      const secondChunk = await reader.read();
      const evidence = new TextDecoder().decode(
        new Uint8Array([
          ...(firstChunk.value ?? new Uint8Array()),
          ...(secondChunk.value ?? new Uint8Array()),
        ]),
      );

      expect(response.status).toBe(200);
      expect(evidence).toContain("event: inventory.updated");
      expect(evidence).toContain(`\"storeId\":\"${store.id}\"`);
      expect(evidence).not.toContain(unassignedStore.id);
      expect(evidence).not.toContain(otherStore.id);
    } finally {
      abortController.abort();
    }
  });

  it("A4-005: an open connection stops receiving events immediately after store access is revoked", async () => {
    const { org, store, cashierUser } = await seedBase({ plan: "BUSINESS" });
    mockGetServerAuthToken.mockResolvedValue({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
      isOrgOwner: false,
      isPlatformOwner: false,
    });
    const abortController = new AbortController();
    const response = await GET(
      new Request("http://localhost/api/sse", { signal: abortController.signal }),
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("SSE response has no readable body");
    }

    try {
      eventBus.publish({
        type: "shift.opened",
        payload: {
          storeId: store.id,
          registerId: "revoke-register",
          shiftId: "allowed-before-revoke",
        },
      });
      const firstChunk = await reader.read();
      const secondChunk = await reader.read();
      const beforeRevocation = new TextDecoder().decode(
        new Uint8Array([
          ...(firstChunk.value ?? new Uint8Array()),
          ...(secondChunk.value ?? new Uint8Array()),
        ]),
      );
      expect(beforeRevocation).toContain("allowed-before-revoke");

      await prisma.userStoreAccess.deleteMany({
        where: { organizationId: org.id, userId: cashierUser.id, storeId: store.id },
      });
      eventBus.publish({
        type: "sale.completed",
        payload: {
          storeId: store.id,
          saleId: "denied-after-revoke",
          number: "SSE-DENIED-002",
        },
      });

      const afterRevocation = await Promise.race([
        reader.read().then((result) => ({ kind: "chunk" as const, result })),
        new Promise<{ kind: "timeout" }>((resolve) => {
          setTimeout(() => resolve({ kind: "timeout" }), 100);
        }),
      ]);
      expect(afterRevocation.kind).toBe("timeout");
    } finally {
      abortController.abort();
    }
  });
});

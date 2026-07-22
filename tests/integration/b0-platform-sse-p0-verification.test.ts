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

describeDb("B0 Agent 4 SSE P0 runtime verification", () => {
  beforeEach(async () => {
    mockGetServerAuthToken.mockReset();
    await resetDatabase();
  });

  it("A4-005: assigned-store cashier receives an event from an unassigned same-org store", async () => {
    const { org, cashierUser } = await seedBase({ plan: "BUSINESS" });
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
      expect(evidence).toContain(`\"storeId\":\"${unassignedStore.id}\"`);
    } finally {
      abortController.abort();
    }
  });
});

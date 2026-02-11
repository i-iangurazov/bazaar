import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    userGuideState: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/server/db/prisma", () => ({ prisma }));

import {
  completeGuidanceTour,
  dismissGuidanceTip,
  resetGuidanceTips,
  resetGuidanceTour,
} from "@/server/services/guidance";

describe("guidance state persistence", () => {
  beforeEach(() => {
    prisma.userGuideState.findUnique.mockReset();
    prisma.userGuideState.create.mockReset();
    prisma.userGuideState.update.mockReset();
  });

  it("dismisses a tip and persists state", async () => {
    prisma.userGuideState.findUnique.mockResolvedValueOnce(null);
    prisma.userGuideState.create.mockResolvedValueOnce({
      userId: "user-1",
      completedToursJson: [],
      dismissedTipsJson: [],
      updatedAt: new Date("2026-02-10T00:00:00.000Z"),
    });
    prisma.userGuideState.update.mockResolvedValueOnce({
      userId: "user-1",
      completedToursJson: [],
      dismissedTipsJson: ["dashboard:store-filter"],
      updatedAt: new Date("2026-02-10T00:01:00.000Z"),
    });

    const result = await dismissGuidanceTip({
      userId: "user-1",
      tipId: "dashboard:store-filter",
    });

    expect(prisma.userGuideState.create).toHaveBeenCalled();
    expect(prisma.userGuideState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        data: { dismissedTipsJson: ["dashboard:store-filter"] },
      }),
    );
    expect(result.dismissedTips).toEqual(["dashboard:store-filter"]);
  });

  it("resets tips by page key", async () => {
    prisma.userGuideState.findUnique.mockResolvedValueOnce({
      userId: "user-1",
      completedToursJson: [],
      dismissedTipsJson: ["dashboard:store-filter", "products:search"],
      updatedAt: new Date("2026-02-10T00:00:00.000Z"),
    });
    prisma.userGuideState.update.mockResolvedValueOnce({
      userId: "user-1",
      completedToursJson: [],
      dismissedTipsJson: ["products:search"],
      updatedAt: new Date("2026-02-10T00:02:00.000Z"),
    });

    const result = await resetGuidanceTips({ userId: "user-1", pageKey: "dashboard" });

    expect(result.dismissedTips).toEqual(["products:search"]);
  });

  it("completes and resets tours", async () => {
    prisma.userGuideState.findUnique.mockResolvedValueOnce({
      userId: "user-1",
      completedToursJson: ["dashboard-tour"],
      dismissedTipsJson: [],
      updatedAt: new Date("2026-02-10T00:00:00.000Z"),
    });
    prisma.userGuideState.update.mockResolvedValueOnce({
      userId: "user-1",
      completedToursJson: ["dashboard-tour", "products-tour"],
      dismissedTipsJson: [],
      updatedAt: new Date("2026-02-10T00:03:00.000Z"),
    });

    const completed = await completeGuidanceTour({
      userId: "user-1",
      tourId: "products-tour",
    });

    expect(completed.completedTours).toEqual(["dashboard-tour", "products-tour"]);

    prisma.userGuideState.findUnique.mockResolvedValueOnce({
      userId: "user-1",
      completedToursJson: ["dashboard-tour", "products-tour"],
      dismissedTipsJson: [],
      updatedAt: new Date("2026-02-10T00:03:00.000Z"),
    });
    prisma.userGuideState.update.mockResolvedValueOnce({
      userId: "user-1",
      completedToursJson: ["dashboard-tour"],
      dismissedTipsJson: [],
      updatedAt: new Date("2026-02-10T00:04:00.000Z"),
    });

    const reset = await resetGuidanceTour({
      userId: "user-1",
      tourId: "products-tour",
    });

    expect(reset.completedTours).toEqual(["dashboard-tour"]);
  });
});

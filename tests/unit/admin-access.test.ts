import { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createTestCaller } from "../helpers/context";

const managerCaller = () =>
  createTestCaller({
    id: "manager-1",
    email: "manager@test.local",
    role: Role.MANAGER,
    organizationId: "org-1",
  });

describe("admin and platform access guards", () => {
  it("blocks non-platform owners from platform procedures", async () => {
    const caller = createTestCaller({
      id: "admin-1",
      email: "admin@test.local",
      role: Role.ADMIN,
      organizationId: "org-1",
      isPlatformOwner: false,
    });

    await expect(caller.platformOwner.summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks managers from technical admin procedures server-side", async () => {
    const caller = managerCaller();

    await expect(caller.adminJobs.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.adminMetrics.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.adminSupport.exportBundle()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

import { ExportType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
}));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: () => mockGetServerAuthToken(),
}));

import { GET } from "@/app/api/exports/[id]/route";
import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("B1 platform export HTTP authorization", () => {
  beforeEach(async () => {
    mockGetServerAuthToken.mockReset();
    await resetDatabase();
  });

  it("A4-003 protects the direct download route for allowed, denied, and cross-org identities", async () => {
    const { org, store, adminUser, managerUser, cashierUser } = await seedBase({
      plan: "BUSINESS",
    });
    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });
    const exportJob = await adminCaller.exports.create({
      storeId: store.id,
      type: ExportType.RECEIPTS_REGISTRY,
      format: "csv",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-21T23:59:59.999Z"),
    });
    await runJob("export-job", { jobId: exportJob.id });

    mockGetServerAuthToken.mockResolvedValue({
      sub: cashierUser.id,
      organizationId: org.id,
      role: cashierUser.role,
    });
    const denied = await GET(new Request("http://localhost/api/exports/denied"), {
      params: { id: exportJob.id },
    });
    expect(denied.status).toBe(403);

    mockGetServerAuthToken.mockResolvedValue({
      sub: "cross-org-manager",
      organizationId: "cross-org-id",
      role: "MANAGER",
    });
    const crossOrg = await GET(new Request("http://localhost/api/exports/cross-org"), {
      params: { id: exportJob.id },
    });
    expect(crossOrg.status).toBe(404);

    const beforeAllowed = await prisma.exportJob.findUniqueOrThrow({
      where: { id: exportJob.id },
      select: { status: true, storagePath: true, fileName: true },
    });
    mockGetServerAuthToken.mockResolvedValue({
      sub: managerUser.id,
      organizationId: org.id,
      role: managerUser.role,
    });
    const allowed = await GET(new Request("http://localhost/api/exports/allowed"), {
      params: { id: exportJob.id },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-disposition")).toContain("receipts-registry-");
    expect(await allowed.text()).toContain("Номер чека");
    await expect(
      prisma.exportJob.findUniqueOrThrow({
        where: { id: exportJob.id },
        select: { status: true, storagePath: true, fileName: true },
      }),
    ).resolves.toEqual(beforeAllowed);
  });
});

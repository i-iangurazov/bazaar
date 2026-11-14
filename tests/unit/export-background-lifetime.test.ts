import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(), store: vi.fn(), create: vi.fn(), find: vi.fn(), update: vi.fn(),
  runJob: vi.fn(), audit: vi.fn(), waitUntil: vi.fn(),
}));
vi.mock("@/server/db/prisma", () => ({ prisma: {
  store: { findFirst: mocks.store }, exportJob: { count: mocks.count, create: mocks.create, findFirst: mocks.find, update: mocks.update },
} }));
vi.mock("@/server/services/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/server/jobs", () => ({ registerJob: vi.fn(), runJob: mocks.runJob }));
vi.mock("@vercel/functions", () => ({ waitUntil: mocks.waitUntil }));

import { requestExport, retryExportJob } from "@/server/services/exports";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL", "1");
  mocks.count.mockResolvedValue(0);
  mocks.store.mockResolvedValue({ id: "synthetic-store", code: "QA", name: "Synthetic store" });
  mocks.create.mockResolvedValue({ id: "synthetic-job", status: "QUEUED" });
  mocks.find.mockResolvedValue({ id: "synthetic-job", status: "FAILED" });
  mocks.update.mockResolvedValue({ id: "synthetic-job", status: "QUEUED" });
  mocks.audit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("serverless export request lifetime", () => {
  it.each(["create", "retry"] as const)("retains a pending %s job after returning the queued response and handles a failed attempt", async (kind) => {
    let rejectJob!: (error: Error) => void;
    const background = new Promise((_resolve, reject) => { rejectJob = reject; });
    mocks.runJob.mockReturnValue(background);
    const result = kind === "create" ? await requestExport({
      organizationId: "synthetic-org", storeId: "synthetic-store", requestedById: "synthetic-user",
      requestId: "synthetic-request", type: "PRICE_LIST", format: "csv",
      periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-02-01"),
    }) : await retryExportJob({ organizationId: "synthetic-org", jobId: "synthetic-job", actorId: "synthetic-user", requestId: "synthetic-request" });
    expect(result).toMatchObject({ id: "synthetic-job", status: "QUEUED" });
    expect(mocks.runJob).toHaveBeenCalledWith("export-job", { jobId: "synthetic-job", organizationId: "synthetic-org", requestId: "synthetic-request" });
    expect(mocks.waitUntil).toHaveBeenCalledOnce();
    expect(mocks.waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
    rejectJob(new Error("synthetic-provider-temporarily-unavailable"));
    await expect(mocks.waitUntil.mock.calls[0]?.[0]).resolves.toBeNull();
  });
});

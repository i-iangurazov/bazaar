import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listJobs, runJob } = vi.hoisted(() => ({
  listJobs: vi.fn(() => ["email-campaign-send"]),
  runJob: vi.fn(async (job: string) => ({ job, status: "ok" as const })),
}));

vi.mock("@/server/jobs", () => ({ listJobs, runJob }));

import { POST } from "../../src/app/api/jobs/run/route";

const secret = "jobs-route-test-secret";

const request = (url: string, body?: unknown, providedSecret = secret) =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-job-secret": providedSecret,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("jobs run route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOBS_SECRET = secret;
  });

  afterEach(() => {
    delete process.env.JOBS_SECRET;
  });

  it("forwards an inline body payload to a named job", async () => {
    const response = await POST(request("http://localhost/api/jobs/run", {
      job: "email-campaign-send",
      organizationId: "org-1",
      campaignId: "campaign-1",
      maxBatches: 2,
    }));

    expect(response.status).toBe(200);
    expect(runJob).toHaveBeenCalledWith("email-campaign-send", {
      organizationId: "org-1",
      campaignId: "campaign-1",
      maxBatches: 2,
    });
  });

  it("forwards an explicit payload when the job is selected by query", async () => {
    const response = await POST(request(
      "http://localhost/api/jobs/run?job=email-campaign-reconcile",
      { payload: { organizationId: "org-1", limit: 25 } },
    ));

    expect(response.status).toBe(200);
    expect(runJob).toHaveBeenCalledWith("email-campaign-reconcile", {
      organizationId: "org-1",
      limit: 25,
    });
  });

  it("rejects ambiguous job names without invoking a job", async () => {
    const response = await POST(request(
      "http://localhost/api/jobs/run?job=email-campaign-send",
      { job: "email-campaign-reconcile" },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "job_name_conflict" });
    expect(runJob).not.toHaveBeenCalled();
  });

  it("rejects oversized payloads before invoking a job", async () => {
    const response = await POST(request("http://localhost/api/jobs/run", {
      job: "email-campaign-send",
      value: "x".repeat(17 * 1024),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "job_request_too_large" });
    expect(runJob).not.toHaveBeenCalled();
  });

  it("keeps job execution protected by the configured secret", async () => {
    const response = await POST(request(
      "http://localhost/api/jobs/run",
      { job: "email-campaign-send", organizationId: "org-1" },
      "wrong-secret",
    ));

    expect(response.status).toBe(401);
    expect(runJob).not.toHaveBeenCalled();
  });
});

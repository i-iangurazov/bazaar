import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/jobs/cron/[group]/route";
import { isAuthorizedCronRequest } from "@/server/jobs/cronAuth";

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalSecret;
  }
});

describe("scheduled jobs route", () => {
  it("uses a bounded constant-time bearer contract", () => {
    const secret = "cron-secret-at-least-16";
    expect(
      isAuthorizedCronRequest(
        new Request("http://localhost/api/jobs/cron/recovery", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        secret,
      ),
    ).toBe(true);
    expect(
      isAuthorizedCronRequest(
        new Request("http://localhost/api/jobs/cron/recovery", {
          headers: { authorization: "Bearer wrong" },
        }),
        secret,
      ),
    ).toBe(false);
    expect(
      isAuthorizedCronRequest(new Request("http://localhost/api/jobs/cron/recovery"), "short"),
    ).toBe(false);
  });

  it("fails closed before dispatch when the secret is absent", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request("http://localhost/api/jobs/cron/recovery"), {
      params: { group: "recovery" },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "cron_not_configured" });
  });

  it("does not reveal valid groups to an unauthorized caller", async () => {
    process.env.CRON_SECRET = "cron-secret-at-least-16";
    const response = await GET(new Request("http://localhost/api/jobs/cron/not-real"), {
      params: { group: "not-real" },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});

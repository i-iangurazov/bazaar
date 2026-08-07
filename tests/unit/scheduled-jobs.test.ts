import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  isScheduledJobGroup,
  runScheduledJobGroup,
  scheduledJobGroups,
} from "@/server/jobs/schedule";

describe("scheduled job recovery", () => {
  it("keeps every durable recovery runner in a fresh-process schedule", () => {
    expect(scheduledJobGroups.recovery).toEqual(
      expect.arrayContaining([
        "export-job",
        "kkm-retry-receipts",
        "order-confirmation-email",
        "mmarket-export",
        "bakai-store-export",
        "o-market-export",
        "product-description-generation",
        "product-image-studio-process",
      ]),
    );
    expect(isScheduledJobGroup("recovery")).toBe(true);
    expect(isScheduledJobGroup("arbitrary-provider-job")).toBe(false);
  });

  it("runs a group once and reports failed job identities without raw errors", async () => {
    const ensureRegistered = vi.fn().mockResolvedValue(undefined);
    const runner = vi.fn(async (job: string) => {
      if (job === "email-campaign-reconcile") {
        throw new Error("provider token must not escape");
      }
      return { job, status: "ok" as const };
    });

    const summary = await runScheduledJobGroup("email", { runner, ensureRegistered });

    expect(ensureRegistered).toHaveBeenCalledWith("email");
    expect(runner).toHaveBeenCalledTimes(scheduledJobGroups.email.length);
    expect(summary).toMatchObject({
      group: "email",
      total: scheduledJobGroups.email.length,
      completed: scheduledJobGroups.email.length - 1,
      failed: 1,
      failedJobs: ["email-campaign-reconcile"],
    });
    expect(JSON.stringify(summary)).not.toContain("provider token");
  });

  it("registers production cron routes at the approved Pro cadence", () => {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };

    expect(config.crons).toEqual(
      expect.arrayContaining([
        { path: "/api/jobs/cron/recovery", schedule: "*/5 * * * *" },
        { path: "/api/jobs/cron/email", schedule: "2-59/5 * * * *" },
        { path: "/api/jobs/cron/maintenance", schedule: "17 3 * * *" },
      ]),
    );
  });
});

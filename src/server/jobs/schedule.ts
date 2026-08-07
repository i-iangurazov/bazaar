import { runJob, type JobPayload, type JobResult } from "@/server/jobs";

export const scheduledJobGroups = {
  recovery: [
    "export-job",
    "kkm-retry-receipts",
    "order-confirmation-email",
    "mmarket-export",
    "bakai-store-export",
    "bakai-store-api-sync",
    "o-market-export",
    "product-description-generation",
    "product-image-studio-process",
  ],
  email: ["email-campaign-send", "email-campaign-reconcile", "customer-order-follow-up"],
  maintenance: ["cleanup-idempotency-keys"],
} as const;

export type ScheduledJobGroup = keyof typeof scheduledJobGroups;

type ScheduledJobRunner = (name: string, payload?: JobPayload) => Promise<JobResult>;

const ensureDynamicallyRegisteredJobs = async (group: ScheduledJobGroup) => {
  if (group !== "recovery") {
    return;
  }
  await Promise.all([
    import("@/server/services/exports"),
    import("@/server/services/kkmConnector"),
  ]);
};

const isFailedResult = (result: JobResult) => {
  if (result.status !== "skipped") {
    return false;
  }
  const reason = result.details?.reason;
  return reason === "failed" || reason === "unknown";
};

export const isScheduledJobGroup = (value: string): value is ScheduledJobGroup =>
  Object.prototype.hasOwnProperty.call(scheduledJobGroups, value);

export const runScheduledJobGroup = async (
  group: ScheduledJobGroup,
  options: {
    runner?: ScheduledJobRunner;
    ensureRegistered?: (group: ScheduledJobGroup) => Promise<void>;
  } = {},
) => {
  await (options.ensureRegistered ?? ensureDynamicallyRegisteredJobs)(group);
  const runner = options.runner ?? runJob;
  const jobs = scheduledJobGroups[group];
  const settled = await Promise.allSettled(jobs.map((job) => runner(job)));
  const failedJobs: string[] = [];
  let completed = 0;
  let skipped = 0;

  settled.forEach((result, index) => {
    const job = jobs[index];
    if (!job) {
      return;
    }
    if (result.status === "rejected" || isFailedResult(result.value)) {
      failedJobs.push(job);
      return;
    }
    if (result.value.status === "skipped") {
      skipped += 1;
      return;
    }
    completed += 1;
  });

  return {
    group,
    total: jobs.length,
    completed,
    skipped,
    failed: failedJobs.length,
    failedJobs,
  };
};

import type { JobPayload, JobResult } from "@/server/jobs";
import { processQueuedOrderConfirmationEmails } from "@/server/services/orderEmails";

export const ORDER_CONFIRMATION_EMAIL_JOB_NAME = "order-confirmation-email";

const asRecord = (payload?: JobPayload) =>
  payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};

export const runOrderConfirmationEmailJob = async (payload?: JobPayload): Promise<JobResult> => {
  const value = asRecord(payload);
  const result = await processQueuedOrderConfirmationEmails({
    logId: typeof value.logId === "string" ? value.logId : undefined,
    limit: typeof value.limit === "number" ? value.limit : undefined,
  });
  return {
    job: ORDER_CONFIRMATION_EMAIL_JOB_NAME,
    status: "ok",
    details: result,
  };
};

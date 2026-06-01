import type { JobPayload, JobResult } from "@/server/jobs";
import { sendDueOrderFollowUpEmails } from "@/server/services/orderEmails";

export const CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME = "customer-order-follow-up";

export const runCustomerOrderFollowUpJob = async (
  payload?: JobPayload,
): Promise<JobResult> => {
  const limit =
    payload && typeof payload === "object" && "limit" in payload
      ? Number((payload as Record<string, unknown>).limit)
      : undefined;

  const result = await sendDueOrderFollowUpEmails({
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  return {
    job: CUSTOMER_ORDER_FOLLOW_UP_JOB_NAME,
    status: "ok",
    details: result,
  };
};

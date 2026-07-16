import type { JobPayload, JobResult } from "@/server/jobs";
import { deliverPendingEmailCampaigns } from "@/server/services/emailMarketing";

export const EMAIL_CAMPAIGN_SEND_JOB_NAME = "email-campaign-send";

export const runEmailCampaignSendJob = async (payload?: JobPayload): Promise<JobResult> => {
  const organizationId =
    payload && typeof payload === "object" && "organizationId" in payload
      ? String((payload as Record<string, unknown>).organizationId ?? "")
      : null;
  const campaignId =
    payload && typeof payload === "object" && "campaignId" in payload
      ? String((payload as Record<string, unknown>).campaignId ?? "")
      : null;
  const batchSize =
    payload && typeof payload === "object" && "batchSize" in payload
      ? Number((payload as Record<string, unknown>).batchSize)
      : null;
  const maxBatches =
    payload && typeof payload === "object" && "maxBatches" in payload
      ? Number((payload as Record<string, unknown>).maxBatches)
      : null;

  const result = await deliverPendingEmailCampaigns({
    organizationId,
    campaignId,
    batchSize: Number.isFinite(batchSize) ? batchSize : null,
    maxBatches: Number.isFinite(maxBatches) ? maxBatches : null,
  });
  return {
    job: EMAIL_CAMPAIGN_SEND_JOB_NAME,
    status: "ok",
    details: {
      organizationId,
      campaignId,
      maxBatches,
      ...result,
    },
  };
};

import type { JobPayload, JobResult } from "@/server/jobs";
import {
  deliverPendingEmailCampaigns,
} from "@/server/services/emailMarketing";
import { reconcileEmailCampaignRecipients } from "@/server/services/emailCampaignDeliveryState";

export const EMAIL_CAMPAIGN_SEND_JOB_NAME = "email-campaign-send";
export const EMAIL_CAMPAIGN_RECONCILE_JOB_NAME = "email-campaign-reconcile";

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

export const runEmailCampaignReconcileJob = async (
  payload?: JobPayload,
): Promise<JobResult> => {
  const record = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const organizationId = String(record.organizationId ?? "").trim() || null;
  const campaignId = String(record.campaignId ?? "").trim() || null;
  const limit = Number(record.limit);
  const result = await reconcileEmailCampaignRecipients({
    organizationId,
    campaignId,
    limit: Number.isFinite(limit) ? limit : null,
  });
  return {
    job: EMAIL_CAMPAIGN_RECONCILE_JOB_NAME,
    status: "ok",
    details: { organizationId, campaignId, ...result },
  };
};

import { z } from "zod";
import { TRIAL_DAYS, TRIAL_PREVIEW_PLAN } from "@/lib/billing/trial";
import { contractPlan, planDefinitionSchema, type ContractTerms } from "./contractTerms";
import { AppError } from "@/server/services/errors";

const trialOfferSchema = z.object({
  version: z.literal(1),
  days: z.literal(7),
  previewPlan: z.literal("ENTERPRISE"),
  entitlements: planDefinitionSchema,
});
export type TrialOffer = z.infer<typeof trialOfferSchema>;

export function createTrialOffer(terms: ContractTerms): TrialOffer {
  const preview = contractPlan(terms, TRIAL_PREVIEW_PLAN);
  const starter = contractPlan(terms, "STARTER");
  return {
    version: 1, days: TRIAL_DAYS, previewPlan: TRIAL_PREVIEW_PLAN,
    entitlements: {
      ...preview,
      limits: { ...starter.limits },
      features: { ...preview.features, emailMarketing: false, marketingAutomation: false,
        ownSender: false, marketplaces: false, bazaarApi: false },
      usageLimits: { ...preview.usageLimits, ai: 100, images: 3, marketingEmails: 0,
        externalApi: 0, marketplaceChannels: 0, marketplaceRunsDaily: 0, marketplaceFullRunsDaily: 0 },
    },
  };
}

export function readTrialOffer(value: unknown): TrialOffer | null {
  if (value == null) return null;
  const parsed = trialOfferSchema.safeParse(value);
  if (!parsed.success) throw new AppError("billingContractNeedsReview", "CONFLICT", 409);
  return parsed.data;
}

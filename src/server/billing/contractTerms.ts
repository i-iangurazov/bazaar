import { z } from "zod";
import { PLAN_CODES, PLAN_FEATURE_CODES, toPlanCode, type PlanCode } from "@/lib/billing/plans";
import {
  CURRENT_CATALOG_VERSION, LEGACY_CATALOG_VERSION, validateSubscriptionExtras,
  type SubscriptionCatalogVersion, type SubscriptionExtras,
} from "@/lib/billing/subscriptionPricing";
import { getPlanCatalogEntries, type PlanDefinition, type PlanFeatureMap } from "./planCatalog";
import { AppError } from "@/server/services/errors";

const quota = z.number().int().nonnegative().nullable();
export const planDefinitionSchema = z.object({
  code: z.enum(PLAN_CODES),
  limits: z.object({ maxStores: z.number().int().positive(), maxProducts: z.number().int().positive(),
    maxActiveUsers: z.number().int().positive() }),
  features: z.object(Object.fromEntries(PLAN_FEATURE_CODES.map((key) => [key, z.boolean()])) as
    { [K in keyof PlanFeatureMap]: z.ZodBoolean }),
  monthlyPriceKgs: z.number().positive().finite(),
  usageLimits: z.object({ ai: quota, images: quota, marketingEmails: quota, externalApi: quota,
    marketplaceChannels: quota, marketplaceRunsDaily: quota, marketplaceFullRunsDaily: quota }),
  countArchivedProducts: z.boolean(),
});
export const contractTermsSchema = z.object({
  version: z.literal(1),
  catalogVersion: z.enum([LEGACY_CATALOG_VERSION, CURRENT_CATALOG_VERSION]),
  plans: z.object({ STARTER: planDefinitionSchema, BUSINESS: planDefinitionSchema,
    ENTERPRISE: planDefinitionSchema }),
});
export type ContractTerms = z.infer<typeof contractTermsSchema>;

export const createContractTerms = (version: SubscriptionCatalogVersion): ContractTerms => ({
  version: 1, catalogVersion: version,
  plans: Object.fromEntries(getPlanCatalogEntries(version).map((entry) => [entry.code, entry])) as
    Record<PlanCode, PlanDefinition>,
});

export const readContractTerms = (value: unknown): ContractTerms | null => {
  if (value == null) return null;
  const parsed = contractTermsSchema.safeParse(value);
  if (!parsed.success) throw new AppError("billingContractNeedsReview", "CONFLICT", 409);
  return parsed.data;
};

export const contractPlan = (terms: ContractTerms, plan: string, extras?: SubscriptionExtras): PlanDefinition => {
  const code = toPlanCode(plan);
  const entry = terms.plans[code];
  if (entry.code !== code) throw new AppError("billingContractNeedsReview", "CONFLICT", 409);
  if (extras) {
    try { validateSubscriptionExtras(code, extras); }
    catch { throw new AppError("billingInvalidExtras", "BAD_REQUEST", 400); }
    if (terms.catalogVersion === LEGACY_CATALOG_VERSION &&
      (extras.stores || extras.productPacks || extras.userPacks))
      throw new AppError("billingInvalidExtras", "BAD_REQUEST", 400);
  }
  const reserve = extras?.productPacks ?? 0;
  return { ...entry, limits: { maxStores: entry.limits.maxStores + (extras?.stores ?? 0),
    maxProducts: entry.limits.maxProducts + reserve * 1000,
    maxActiveUsers: entry.limits.maxActiveUsers + reserve * 2 } };
};

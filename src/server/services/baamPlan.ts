import { z } from "zod";
import { productPlanSchema, productPlanJsonSchema } from "@/server/services/baamProductPlan";

export const metricRefs = [
  "sales",
  "net_sales",
  "receipts",
  "average_receipt",
  "returns",
  "return_ratio",
  "payments",
  "discounts",
] as const;
export const intents = [
  "summary",
  "comparison",
  "returns",
  "payments",
  "diagnostics",
  "unsupported",
] as const;
export const limitations = [
  "none",
  "causes",
  "forecast",
  "profit",
  "other_data",
  "actions",
  "scope",
] as const;
export const salesPlanSchema = z
  .object({
    intent: z.enum(intents),
    metrics: z.array(z.enum(metricRefs)).min(1).max(4),
    limitation: z.enum(limitations),
  })
  .strict()
  .refine((plan) => (plan.intent === "unsupported") !== (plan.limitation === "none"));
export type SalesPlan = z.infer<typeof salesPlanSchema>;
export const planSchema = z.union([salesPlanSchema, productPlanSchema]);
export type Plan = z.infer<typeof planSchema>;
export const responsePlanSchema = z.object({ plan: planSchema }).strict();
export const responsePlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["plan"],
  properties: {
    plan: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["intent", "metrics", "limitation"],
          properties: {
            intent: { type: "string", enum: intents },
            metrics: {
              type: "array",
              items: { type: "string", enum: metricRefs },
              minItems: 1,
              maxItems: 4,
            },
            limitation: { type: "string", enum: limitations },
          },
        },
        productPlanJsonSchema,
      ],
    },
  },
} as const;

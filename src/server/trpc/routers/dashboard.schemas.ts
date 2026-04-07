import { z } from "zod";

export const dashboardSummaryOptionsSchema = z.object({
  includeRecentActivity: z.boolean().optional(),
  includeRecentMovements: z.boolean().optional(),
});

export const dashboardSummaryInputSchema = z.object({
  storeId: z.string(),
  includeRecentActivity: z.boolean().optional(),
  includeRecentMovements: z.boolean().optional(),
});

export const dashboardBootstrapInputSchema = z
  .object({
    storeId: z.string().optional(),
    includeRecentActivity: z.boolean().optional(),
    includeRecentMovements: z.boolean().optional(),
  })
  .optional();

export const dashboardActivityInputSchema = z.object({
  storeId: z.string(),
});

export type DashboardSummaryInput = z.infer<typeof dashboardSummaryInputSchema>;
export type DashboardBootstrapInput = z.infer<typeof dashboardBootstrapInputSchema>;
export type DashboardActivityInput = z.infer<typeof dashboardActivityInputSchema>;

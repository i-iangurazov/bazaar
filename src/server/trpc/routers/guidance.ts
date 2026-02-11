import { z } from "zod";

import { protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import {
  completeGuidanceTour,
  dismissGuidanceTip,
  getGuidanceState,
  syncGuidanceState,
  resetGuidanceTips,
  resetGuidanceTour,
} from "@/server/services/guidance";

export const guidanceRouter = router({
  getState: protectedProcedure.query(async ({ ctx }) => {
    return getGuidanceState(ctx.user.id);
  }),

  dismissTip: protectedProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "guidance-dismiss-tip" }))
    .input(z.object({ tipId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return dismissGuidanceTip({ userId: ctx.user.id, tipId: input.tipId });
    }),

  resetTips: protectedProcedure
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "guidance-reset-tips" }))
    .input(z.object({ pageKey: z.string().min(1).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      return resetGuidanceTips({ userId: ctx.user.id, pageKey: input?.pageKey });
    }),

  completeTour: protectedProcedure
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "guidance-complete-tour" }))
    .input(z.object({ tourId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return completeGuidanceTour({ userId: ctx.user.id, tourId: input.tourId });
    }),

  resetTour: protectedProcedure
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "guidance-reset-tour" }))
    .input(z.object({ tourId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return resetGuidanceTour({ userId: ctx.user.id, tourId: input.tourId });
    }),

  syncState: protectedProcedure
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "guidance-sync-state" }))
    .input(
      z.object({
        dismissedTips: z.array(z.string().min(1)).optional(),
        dismissedAutoTours: z.array(z.string().min(1)).optional(),
        completedTours: z.array(z.string().min(1)).optional(),
        toursDisabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return syncGuidanceState({
        userId: ctx.user.id,
        dismissedTips: input.dismissedTips,
        dismissedAutoTours: input.dismissedAutoTours,
        completedTours: input.completedTours,
        toursDisabled: input.toursDisabled,
      });
    }),
});

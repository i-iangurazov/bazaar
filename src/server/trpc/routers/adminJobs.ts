import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { adminProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { listDeadLetterJobs, retryDeadLetterJob, resolveDeadLetterJob } from "@/server/services/deadLetterJobs";

const jobScopeSchema = z.enum(["TENANT", "GLOBAL"]);

const resolveJobOrganizationId = (
  user: { organizationId: string; isPlatformOwner?: boolean | null },
  scope: z.infer<typeof jobScopeSchema>,
) => {
  if (scope === "GLOBAL") {
    if (!user.isPlatformOwner) {
      throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
    }
    return null;
  }
  return user.organizationId;
};

export const adminJobsRouter = router({
  list: adminProcedure
    .input(z.object({ scope: jobScopeSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scope = input?.scope ?? "TENANT";
      return listDeadLetterJobs({
        organizationId: resolveJobOrganizationId(ctx.user, scope),
      });
    }),

  retry: adminProcedure
    .input(z.object({ jobId: z.string(), scope: jobScopeSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const jobOrganizationId = resolveJobOrganizationId(ctx.user, input.scope ?? "TENANT");
        return await retryDeadLetterJob({
          jobId: input.jobId,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          jobOrganizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  resolve: adminProcedure
    .input(z.object({ jobId: z.string(), scope: jobScopeSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const jobOrganizationId = resolveJobOrganizationId(ctx.user, input.scope ?? "TENANT");
        return await resolveDeadLetterJob({
          jobId: input.jobId,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          jobOrganizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

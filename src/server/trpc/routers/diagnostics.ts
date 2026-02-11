import { z } from "zod";

import { rateLimit, router, orgOwnerProcedure } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  diagnosticsCheckTypes,
  getLastDiagnosticsReport,
  runDiagnosticsChecks,
} from "@/server/services/diagnostics";

const diagnosticsInputSchema = z
  .object({
    sendEmailTest: z.boolean().optional(),
    confirmEmailInProduction: z.boolean().optional(),
  })
  .optional();

const getEmailOptions = (
  input: z.infer<typeof diagnosticsInputSchema>,
): { sendEmailTest: boolean; confirmEmailInProduction: boolean } => ({
  sendEmailTest: Boolean(input?.sendEmailTest),
  confirmEmailInProduction: Boolean(input?.confirmEmailInProduction),
});

export const diagnosticsRouter = router({
  getLastReport: orgOwnerProcedure.query(async ({ ctx }) => {
    try {
      return await getLastDiagnosticsReport(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  runAll: orgOwnerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 3, prefix: "diagnostics-run-all" }))
    .input(diagnosticsInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const emailOptions = getEmailOptions(input);
        return await runDiagnosticsChecks({
          organizationId: ctx.user.organizationId,
          userId: ctx.user.id,
          userEmail: ctx.user.email,
          requestId: ctx.requestId,
          checks: [...diagnosticsCheckTypes],
          ...emailOptions,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  runOne: orgOwnerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 10, prefix: "diagnostics-run-one" }))
    .input(
      z.object({
        check: z.enum(diagnosticsCheckTypes),
        sendEmailTest: z.boolean().optional(),
        confirmEmailInProduction: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const shouldSendEmailTest = input.check === "email" ? Boolean(input.sendEmailTest) : false;
        return await runDiagnosticsChecks({
          organizationId: ctx.user.organizationId,
          userId: ctx.user.id,
          userEmail: ctx.user.email,
          requestId: ctx.requestId,
          checks: [input.check],
          sendEmailTest: shouldSendEmailTest,
          confirmEmailInProduction: Boolean(input.confirmEmailInProduction),
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});


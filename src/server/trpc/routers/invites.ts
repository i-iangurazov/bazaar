import { z } from "zod";

import { adminProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { createInvite } from "@/server/services/invites";
import { sendInviteEmail } from "@/server/services/email";
import { prisma } from "@/server/db/prisma";

export const invitesRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return prisma.inviteToken.findMany({
      where: { organizationId: ctx.user.organizationId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
  }),

  create: adminProcedure
    .input(z.object({ email: z.string().email(), role: z.enum(["ADMIN", "MANAGER", "STAFF", "CASHIER"]) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await createInvite({
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          requestId: ctx.requestId,
          email: input.email,
          role: input.role,
        });
        const baseUrl = process.env.NEXTAUTH_URL ?? "";
        if (baseUrl) {
          await sendInviteEmail({ email: result.invite.email, inviteLink: `${baseUrl}/invite/${result.token}` });
        }
        return result;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

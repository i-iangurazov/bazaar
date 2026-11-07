import { z } from "zod";
import { router, whatsappProcedure, rateLimit } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  whatsappPackSelectionSchema,
  whatsappProfileSchema,
  whatsappKnowledgeSchema,
} from "@/lib/whatsapp-ai";
import * as workspace from "@/server/whatsapp/workspace";
import * as payments from "@/server/whatsapp/payments";
import { whatsappConnection } from "@/server/whatsapp/access";
import { generateWhatsAppAnswer } from "@/server/whatsapp/assistant";
import { AppError } from "@/server/services/errors";
import { prisma } from "@/server/db/prisma";

const id = z.string().regex(/^[a-zA-Z0-9_-]{10,80}$/);
const store = z.object({ storeId: id });
const conversation = z.object({ conversationId: id });
const safe = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    throw toTRPCError(error);
  }
};
const mutation = whatsappProcedure.use(
  rateLimit({ windowMs: 60_000, max: 40, prefix: "whatsapp-actions" }),
);

export const whatsappAiRouter = router({
  stores: whatsappProcedure.query(({ ctx }) => safe(() => workspace.whatsappStores(ctx.user))),
  workspace: whatsappProcedure
    .input(store)
    .query(({ ctx, input }) => safe(() => workspace.whatsAppWorkspace(ctx.user, input.storeId))),
  save: mutation
    .input(
      store.extend({
        expectedVersion: z.number().int().positive().nullable(),
        profile: whatsappProfileSchema,
        knowledge: whatsappKnowledgeSchema,
        knowledgeConfirmed: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      safe(() => workspace.saveWhatsAppProfile(ctx.user, input, ctx.requestId)),
    ),
  begin: mutation
    .input(store.extend({ locale: z.enum(["ru", "kg", "en"]) }))
    .mutation(({ ctx, input }) =>
      safe(() =>
        workspace.beginWhatsAppOnboarding(ctx.user, input.storeId, input.locale, ctx.requestId),
      ),
    ),
  finish: mutation
    .input(store.extend({ state: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(({ ctx, input }) =>
      safe(() =>
        workspace.finishWhatsAppOnboarding(ctx.user, input.storeId, input.state, ctx.requestId),
      ),
    ),
  enable: mutation
    .input(store.extend({ enabled: z.boolean() }))
    .mutation(({ ctx, input }) =>
      safe(() =>
        workspace.setWhatsAppEnabled(ctx.user, input.storeId, input.enabled, ctx.requestId),
      ),
    ),
  conversations: whatsappProcedure
    .input(
      store.extend({
        search: z.string().trim().max(100).optional(),
        filter: z.enum(["all", "human", "unread", "archived"]).default("all"),
        cursor: id.optional(),
      }),
    )
    .query(({ ctx, input }) => safe(() => workspace.listWhatsAppConversations(ctx.user, input))),
  conversation: whatsappProcedure
    .input(conversation)
    .query(({ ctx, input }) =>
      safe(() => workspace.readWhatsAppConversation(ctx.user, input.conversationId)),
    ),
  seen: mutation
    .input(conversation.extend({ sequence: z.number().int().min(0) }))
    .mutation(({ ctx, input }) =>
      safe(() => workspace.markWhatsAppSeen(ctx.user, input.conversationId, input.sequence)),
    ),
  mode: mutation
    .input(
      conversation.extend({
        mode: z.enum(["AI", "HUMAN"]),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(({ ctx, input }) =>
      safe(() =>
        workspace.setWhatsAppConversationMode(
          ctx.user,
          input.conversationId,
          input.mode,
          input.expectedVersion,
          ctx.requestId,
        ),
      ),
    ),
  archive: mutation
    .input(conversation.extend({ archived: z.boolean() }))
    .mutation(({ ctx, input }) =>
      safe(() =>
        workspace.archiveWhatsAppConversation(
          ctx.user,
          input.conversationId,
          input.archived,
          ctx.requestId,
        ),
      ),
    ),
  erase: mutation
    .input(conversation.extend({ confirmed: z.literal(true) }))
    .mutation(({ ctx, input }) =>
      safe(() =>
        workspace.eraseWhatsAppConversation(ctx.user, input.conversationId, ctx.requestId),
      ),
    ),
  send: mutation
    .input(
      conversation.extend({
        body: z.string().trim().min(1).max(4096),
        idempotencyKey: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      safe(() => workspace.queueWhatsAppManual(ctx.user, input, ctx.requestId)),
    ),
  payments: whatsappProcedure.query(({ ctx }) =>
    safe(() => payments.whatsAppPaymentState(ctx.user)),
  ),
  checkout: mutation
    .input(store.extend({ selection: whatsappPackSelectionSchema }))
    .mutation(({ ctx, input }) =>
      safe(() =>
        payments.createWhatsAppCheckout(ctx.user, input.storeId, input.selection, ctx.requestId),
      ),
    ),
  checkPayment: mutation
    .input(z.object({ invoiceId: z.string().regex(/^wa_[a-f0-9]{32}$/) }))
    .mutation(({ ctx, input }) =>
      safe(() => payments.checkWhatsAppPayment(ctx.user, input.invoiceId)),
    ),
  preview: whatsappProcedure
    .use(rateLimit({ windowMs: 60_000, max: 3, prefix: "whatsapp-preview" }))
    .input(store.extend({ message: z.string().trim().min(1).max(1000) }))
    .mutation(({ ctx, input }) =>
      safe(async () => {
        const { connection } = await whatsappConnection(ctx.user, input.storeId, { active: true });
        if (!connection?.knowledgePublished)
          throw new AppError("whatsappKnowledgeRequired", "CONFLICT", 409);
        const key = `preview:${ctx.user.organizationId}:${new Date().toISOString().slice(0, 10)}`;
        await prisma.whatsAppWorkerState.upsert({
          where: { id: key },
          create: { id: key, state: "PREVIEW", dailyPeriod: key.slice(-10) },
          update: {},
        });
        const reserved = await prisma.whatsAppWorkerState.updateMany({
          where: { id: key, spentMicros: { lt: BigInt(20) } },
          data: { spentMicros: { increment: BigInt(1) } },
        });
        if (!reserved.count) throw new AppError("rateLimited", "TOO_MANY_REQUESTS", 429);
        const answer = await generateWhatsAppAnswer({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          incoming: input.message,
          profile: connection.profile,
          knowledge: connection.knowledge,
          firstReply: true,
        });
        return { body: answer.body, needsHuman: answer.needsHuman };
      }),
    ),
});

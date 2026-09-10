import { z } from "zod";
import { managerProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { getBaamSalesMetrics } from "@/server/services/baamMetrics";
import { askBaam, baamAskSchema, getBaamCapabilities } from "@/server/services/baamAssistant";
import { baamLocaleSchema, baamSendSchema } from "@/lib/baam/companion";
import {
  changeBaamConversation,
  createBaamConversation,
  listBaamConversations,
  readBaamConversation,
  stopBaamTurn,
} from "@/server/services/baamConversations";
import {
  abortBaamGeneration,
  baamCompanionCapabilities,
  sendBaamMessage,
} from "@/server/services/baamCompanion";
import { cancelBaamAction, executeBaamAction } from "@/server/services/baamActions";

const companion = managerProcedure;
const handle = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    throw toTRPCError(error);
  }
};

export const baamRouter = router({
  companion: companion.query(({ ctx }) => handle(() => baamCompanionCapabilities(ctx))),
  conversations: companion
    .input(z.object({ cursor: z.string().optional() }).optional())
    .query(({ ctx, input }) => handle(() => listBaamConversations(ctx, input?.cursor))),
  createConversation: companion
    .input(z.object({ locale: baamLocaleSchema, storeId: z.string().optional() }).strict())
    .mutation(({ ctx, input }) => handle(() => createBaamConversation(ctx, input))),
  conversation: companion
    .input(z.object({ id: z.string(), before: z.number().int().positive().optional() }).strict())
    .query(({ ctx, input }) => handle(() => readBaamConversation(ctx, input.id, input.before))),
  changeConversation: companion
    .input(
      z
        .object({
          id: z.string(),
          title: z.string().trim().min(1).max(100).optional(),
          storeId: z.string().nullable().optional(),
          remove: z.boolean().optional(),
          revision: z.number().int().nonnegative(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => handle(() => changeBaamConversation(ctx, input))),
  send: companion
    .use(rateLimit({ windowMs: 60_000, max: 12, prefix: "baam-companion" }))
    .input(baamSendSchema)
    .mutation(({ ctx, input }) => handle(() => sendBaamMessage(ctx, input))),
  stop: companion
    .input(z.object({ conversationId: z.string() }).strict())
    .mutation(({ ctx, input }) =>
      handle(async () => {
        const result = await stopBaamTurn(ctx, input.conversationId);
        abortBaamGeneration(input.conversationId);
        return result;
      }),
    ),
  execute: companion
    .use(rateLimit({ windowMs: 60_000, max: 20, prefix: "baam-execute" }))
    .input(z.object({ actionId: z.string() }).strict())
    .mutation(({ ctx, input }) => handle(() => executeBaamAction(ctx, input.actionId))),
  cancelAction: companion
    .input(z.object({ actionId: z.string() }).strict())
    .mutation(({ ctx, input }) => handle(() => cancelBaamAction(ctx, input.actionId))),
  capabilities: managerProcedure.query(async ({ ctx }) => {
    try {
      return await getBaamCapabilities(ctx.user.id);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  ask: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "baam-ask" }))
    .input(baamAskSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await askBaam({ ...input, actorId: ctx.user.id });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  overview: managerProcedure
    .input(
      z
        .object({
          dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          storeId: z.string().min(1).optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getBaamSalesMetrics({ ...input, actorId: ctx.user.id });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

import { z } from "zod";

import {
  createBazaarApiKey,
  listBazaarApiKeys,
  revokeBazaarApiKey,
} from "@/server/services/bazaarApi";
import { assertUserCanAccessStore, listAccessibleStores } from "@/server/services/storeAccess";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, router } from "@/server/trpc/trpc";

export const bazaarApiRouter = router({
  listStores: managerProcedure.query(async ({ ctx }) => {
    try {
      const stores = await listAccessibleStores(ctx.prisma, ctx.user);
      const keys = stores.length
        ? await ctx.prisma.bazaarApiKey.groupBy({
            by: ["storeId"],
            where: {
              organizationId: ctx.user.organizationId,
              storeId: { in: stores.map((store) => store.id) },
              revokedAt: null,
            },
            _count: { _all: true },
          })
        : [];
      const countByStore = new Map(keys.map((row) => [row.storeId, row._count._all]));
      return stores.map((store) => ({
        storeId: store.id,
        storeName: store.name,
        activeKeyCount: countByStore.get(store.id) ?? 0,
      }));
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  apiKeys: managerProcedure
    .input(z.object({ storeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await listBazaarApiKeys({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  createApiKey: managerProcedure
    .input(z.object({ storeId: z.string().min(1), name: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await createBazaarApiKey({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  revokeApiKey: managerProcedure
    .input(z.object({ storeId: z.string().min(1), apiKeyId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await revokeBazaarApiKey({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          apiKeyId: input.apiKeyId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

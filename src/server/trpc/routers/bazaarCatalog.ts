import {
  BazaarCatalogFontFamily,
  BazaarCatalogHeaderStyle,
  BazaarCatalogStatus,
} from "@prisma/client";
import { z } from "zod";

import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { assertUserCanAccessStore, listAccessibleStores } from "@/server/services/storeAccess";
import {
  createBazaarApiKey,
  listBazaarApiKeys,
  revokeBazaarApiKey,
} from "@/server/services/bazaarApi";
import {
  getBazaarCatalogSettings,
  listBazaarCatalogProducts,
  listBazaarCatalogStores,
  updateBazaarCatalogProductVisibility,
  upsertBazaarCatalogSettings,
} from "@/server/services/bazaarCatalog";

export const bazaarCatalogRouter = router({
  listStores: managerProcedure.query(async ({ ctx }) => {
    try {
      const stores = await listAccessibleStores(ctx.prisma, ctx.user);
      return await listBazaarCatalogStores(
        ctx.user.organizationId,
        stores.map((store) => store.id),
      );
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  getSettings: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await getBazaarCatalogSettings({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  products: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        search: z.string().max(200).optional(),
        visibility: z.enum(["all", "visible", "hidden"]).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(10).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await listBazaarCatalogProducts({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          search: input.search,
          visibility: input.visibility,
          page: input.page,
          pageSize: input.pageSize,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateProducts: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        productIds: z.array(z.string().min(1)).min(1).max(500),
        hidden: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await updateBazaarCatalogProductVisibility({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productIds: input.productIds,
          hidden: input.hidden,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  apiKeys: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
      }),
    )
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
    .input(
      z.object({
        storeId: z.string().min(1),
        name: z.string().trim().min(1).max(120),
      }),
    )
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
    .input(
      z.object({
        storeId: z.string().min(1),
        apiKeyId: z.string().min(1),
      }),
    )
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

  upsert: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        title: z.string().max(140).optional().nullable(),
        accentColor: z.string().max(7).optional().nullable(),
        fontFamily: z.nativeEnum(BazaarCatalogFontFamily).optional(),
        headerStyle: z.nativeEnum(BazaarCatalogHeaderStyle).optional(),
        logoImageId: z.string().optional().nullable(),
        status: z.nativeEnum(BazaarCatalogStatus),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await upsertBazaarCatalogSettings({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          title: input.title,
          accentColor: input.accentColor,
          fontFamily: input.fontFamily,
          headerStyle: input.headerStyle,
          logoImageId: input.logoImageId,
          status: input.status,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

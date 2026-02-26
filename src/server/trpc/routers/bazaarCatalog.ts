import {
  BazaarCatalogFontFamily,
  BazaarCatalogHeaderStyle,
  BazaarCatalogStatus,
} from "@prisma/client";
import { z } from "zod";

import { managerProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  getBazaarCatalogSettings,
  listBazaarCatalogStores,
  upsertBazaarCatalogSettings,
} from "@/server/services/bazaarCatalog";

export const bazaarCatalogRouter = router({
  listStores: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await listBazaarCatalogStores(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  getSettings: protectedProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getBazaarCatalogSettings({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
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

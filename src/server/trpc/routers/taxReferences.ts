import { TaxReferenceDocumentType } from "@prisma/client";
import { z } from "zod";

import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  listEsfReferences,
  listEttnReferences,
  upsertEsfReference,
  upsertEttnReference,
} from "@/server/services/taxReferences";

export const taxReferencesRouter = router({
  ettn: router({
    list: managerProcedure
      .input(
        z
          .object({
            storeId: z.string().optional(),
            documentType: z.nativeEnum(TaxReferenceDocumentType).optional(),
            dateFrom: z.coerce.date().optional(),
            dateTo: z.coerce.date().optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await listEttnReferences({
            organizationId: ctx.user.organizationId,
            storeId: input?.storeId,
            documentType: input?.documentType,
            dateFrom: input?.dateFrom,
            dateTo: input?.dateTo,
            page: input?.page ?? 1,
            pageSize: input?.pageSize ?? 25,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
    upsert: managerProcedure
      .input(
        z.object({
          storeId: z.string().min(1),
          documentType: z.nativeEnum(TaxReferenceDocumentType),
          documentId: z.string().min(1).max(64),
          ettnNumber: z.string().min(1).max(128),
          ettnDate: z.coerce.date().optional().nullable(),
          notes: z.string().max(1000).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await upsertEttnReference({
            organizationId: ctx.user.organizationId,
            storeId: input.storeId,
            documentType: input.documentType,
            documentId: input.documentId,
            ettnNumber: input.ettnNumber,
            ettnDate: input.ettnDate ?? null,
            notes: input.notes ?? null,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
  }),
  esf: router({
    list: managerProcedure
      .input(
        z
          .object({
            storeId: z.string().optional(),
            documentType: z.nativeEnum(TaxReferenceDocumentType).optional(),
            dateFrom: z.coerce.date().optional(),
            dateTo: z.coerce.date().optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await listEsfReferences({
            organizationId: ctx.user.organizationId,
            storeId: input?.storeId,
            documentType: input?.documentType,
            dateFrom: input?.dateFrom,
            dateTo: input?.dateTo,
            page: input?.page ?? 1,
            pageSize: input?.pageSize ?? 25,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
    upsert: managerProcedure
      .input(
        z.object({
          storeId: z.string().min(1),
          documentType: z.nativeEnum(TaxReferenceDocumentType),
          documentId: z.string().min(1).max(64),
          esfNumber: z.string().min(1).max(128),
          esfDate: z.coerce.date().optional().nullable(),
          counterpartyName: z.string().max(160).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await upsertEsfReference({
            organizationId: ctx.user.organizationId,
            storeId: input.storeId,
            documentType: input.documentType,
            documentId: input.documentId,
            esfNumber: input.esfNumber,
            esfDate: input.esfDate ?? null,
            counterpartyName: input.counterpartyName ?? null,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
  }),
});

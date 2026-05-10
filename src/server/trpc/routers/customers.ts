import { CustomerSource } from "@prisma/client";
import { z } from "zod";

import {
  createCustomer,
  deleteCustomer,
  listCustomers,
  previewCustomerImport,
  runCustomerImport,
  updateCustomer,
} from "@/server/services/customers";
import { toTRPCError } from "@/server/trpc/errors";
import { managerProcedure, rateLimit, router } from "@/server/trpc/trpc";

const customerInputSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().trim().min(1).max(180),
  email: z.string().trim().max(254).optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
});

const importRowSchema = z.object({
  name: z.string().max(180).optional().nullable(),
  email: z.string().max(254).optional().nullable(),
  phone: z.string().max(80).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  rowNumber: z.number().int().min(1).optional(),
});

export const customersRouter = router({
  list: managerProcedure
    .input(
      z
        .object({
          storeId: z.string().min(1).optional().nullable(),
          search: z.string().max(200).optional().nullable(),
          source: z.union([z.nativeEnum(CustomerSource), z.literal("ALL")]).optional().nullable(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listCustomers({
          user: ctx.user,
          storeId: input?.storeId,
          search: input?.search,
          source: input?.source,
          page: input?.page,
          pageSize: input?.pageSize,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  create: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 30, prefix: "customer-create" }))
    .input(customerInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createCustomer({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          ...input,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  update: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 40, prefix: "customer-update" }))
    .input(
      customerInputSchema.omit({ storeId: true }).extend({
        customerId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateCustomer({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          ...input,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  delete: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 40, prefix: "customer-delete" }))
    .input(z.object({ customerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteCustomer({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          customerId: input.customerId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  previewImport: managerProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        rows: z.array(importRowSchema).max(5_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await previewCustomerImport({
          user: ctx.user,
          storeId: input.storeId,
          rows: input.rows,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  importRows: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 8, prefix: "customer-import" }))
    .input(
      z.object({
        storeId: z.string().min(1),
        rows: z.array(importRowSchema).max(5_000),
        source: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await runCustomerImport({
          user: ctx.user,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          storeId: input.storeId,
          rows: input.rows,
          source: input.source,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

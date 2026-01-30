import { z } from "zod";

import { managerProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  bulkDeleteSuppliers,
  createSupplier,
  deleteSupplier,
  updateSupplier,
} from "@/server/services/suppliers";

export const suppliersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.supplier.findMany({
      where: { organizationId: ctx.user.organizationId },
      orderBy: { name: "asc" },
    });
  }),

  create: managerProcedure
    .input(
      z.object({
        name: z.string().min(2),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createSupplier({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          notes: input.notes,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  update: managerProcedure
    .input(
      z.object({
        supplierId: z.string(),
        name: z.string().min(2),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateSupplier({
          supplierId: input.supplierId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          notes: input.notes,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  delete: managerProcedure
    .input(z.object({ supplierId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteSupplier({
          supplierId: input.supplierId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkDelete: managerProcedure
    .input(z.object({ supplierIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await bulkDeleteSuppliers({
          supplierIds: input.supplierIds,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

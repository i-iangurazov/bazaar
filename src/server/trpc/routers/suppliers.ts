import type { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
  SUPPLIER_NOTES_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from "@/lib/supplierForm";
import { managerProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  bulkDeleteSuppliers,
  createSupplier,
  deleteSupplier,
  updateSupplier,
} from "@/server/services/suppliers";

export const suppliersRouter = router({
  list: managerProcedure.query(async ({ ctx }) => {
    return ctx.prisma.supplier.findMany({
      where: { organizationId: ctx.user.organizationId },
      orderBy: { name: "asc" },
    });
  }),

  listPage: managerProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const search = input.search?.trim();
      const where: Prisma.SupplierWhereInput = {
        organizationId: ctx.user.organizationId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.supplier.findMany({
          where,
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.supplier.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }),

  create: managerProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(SUPPLIER_NAME_MAX_LENGTH),
        email: z.string().trim().email().max(SUPPLIER_EMAIL_MAX_LENGTH).optional(),
        phone: z.string().trim().max(SUPPLIER_PHONE_MAX_LENGTH).optional(),
        notes: z.string().trim().max(SUPPLIER_NOTES_MAX_LENGTH).optional(),
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
        name: z.string().trim().min(2).max(SUPPLIER_NAME_MAX_LENGTH),
        email: z.string().trim().email().max(SUPPLIER_EMAIL_MAX_LENGTH).optional(),
        phone: z.string().trim().max(SUPPLIER_PHONE_MAX_LENGTH).optional(),
        notes: z.string().trim().max(SUPPLIER_NOTES_MAX_LENGTH).optional(),
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

import { z } from "zod";

import { managerProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { AppError } from "@/server/services/errors";

const definitionBaseSchema = z.object({
  key: z.string().min(1),
  labelRu: z.string().min(1),
  labelKg: z.string().min(1),
  type: z.enum(["TEXT", "NUMBER", "SELECT", "MULTI_SELECT"]),
  optionsRu: z.array(z.string()).optional(),
  optionsKg: z.array(z.string()).optional(),
  required: z.boolean().optional(),
});

const addOptionsRequirement = (
  values: z.infer<typeof definitionBaseSchema>,
  ctx: z.RefinementCtx,
) => {
  const needsOptions = values.type === "SELECT" || values.type === "MULTI_SELECT";
  const hasRu = (values.optionsRu?.length ?? 0) > 0;
  const hasKg = (values.optionsKg?.length ?? 0) > 0;
  if (needsOptions && (!hasRu || !hasKg)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "attributeOptionsRequired",
      path: ["optionsRu"],
    });
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "attributeOptionsRequired",
      path: ["optionsKg"],
    });
  }
};

const definitionSchema = definitionBaseSchema.superRefine(addOptionsRequirement);
const definitionUpdateSchema = definitionBaseSchema
  .extend({ id: z.string() })
  .superRefine(addOptionsRequirement);

export const attributesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.attributeDefinition.findMany({
      where: { organizationId: ctx.user.organizationId, isActive: true },
      orderBy: { key: "asc" },
    });
  }),

  create: managerProcedure
    .input(definitionSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const key = input.key.trim().toLowerCase();
        const existing = await ctx.prisma.attributeDefinition.findUnique({
          where: {
            organizationId_key: {
              organizationId: ctx.user.organizationId,
              key,
            },
          },
        });
        if (existing?.isActive) {
          throw new AppError("attributeExists", "CONFLICT", 409);
        }

        const definition = existing
          ? await ctx.prisma.attributeDefinition.update({
              where: { id: existing.id },
              data: {
                key,
                labelRu: input.labelRu.trim(),
                labelKg: input.labelKg.trim(),
                type: input.type,
                optionsRu: input.optionsRu ?? undefined,
                optionsKg: input.optionsKg ?? undefined,
                required: input.required ?? false,
                isActive: true,
              },
            })
          : await ctx.prisma.attributeDefinition.create({
              data: {
                organizationId: ctx.user.organizationId,
                key,
                labelRu: input.labelRu.trim(),
                labelKg: input.labelKg.trim(),
                type: input.type,
                optionsRu: input.optionsRu ?? undefined,
                optionsKg: input.optionsKg ?? undefined,
                required: input.required ?? false,
                isActive: true,
              },
            });

        await writeAuditLog(ctx.prisma, {
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          action: "ATTRIBUTE_CREATE",
          entity: "AttributeDefinition",
          entityId: definition.id,
          before: existing ? toJson(existing) : null,
          after: toJson(definition),
          requestId: ctx.requestId,
        });

        return definition;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  update: managerProcedure
    .input(definitionUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const existing = await ctx.prisma.attributeDefinition.findUnique({ where: { id: input.id } });
        if (!existing || existing.organizationId !== ctx.user.organizationId) {
          throw new AppError("attributeNotFound", "NOT_FOUND", 404);
        }
        const key = input.key.trim().toLowerCase();
        const definition = await ctx.prisma.attributeDefinition.update({
          where: { id: input.id },
          data: {
            key,
            labelRu: input.labelRu.trim(),
            labelKg: input.labelKg.trim(),
            type: input.type,
            optionsRu: input.optionsRu ?? undefined,
            optionsKg: input.optionsKg ?? undefined,
            required: input.required ?? false,
          },
        });

        await writeAuditLog(ctx.prisma, {
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          action: "ATTRIBUTE_UPDATE",
          entity: "AttributeDefinition",
          entityId: definition.id,
          before: toJson(existing),
          after: toJson(definition),
          requestId: ctx.requestId,
        });

        return definition;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  remove: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const existing = await ctx.prisma.attributeDefinition.findUnique({ where: { id: input.id } });
        if (!existing || existing.organizationId !== ctx.user.organizationId) {
          throw new AppError("attributeNotFound", "NOT_FOUND", 404);
        }
        const usage = await ctx.prisma.variantAttributeValue.count({
          where: { organizationId: ctx.user.organizationId, key: existing.key },
        });
        if (usage > 0) {
          throw new AppError("attributeInUse", "CONFLICT", 409);
        }
        const removed = await ctx.prisma.attributeDefinition.delete({ where: { id: input.id } });

        await writeAuditLog(ctx.prisma, {
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          action: "ATTRIBUTE_DELETE",
          entity: "AttributeDefinition",
          entityId: removed.id,
          before: toJson(existing),
          after: null,
          requestId: ctx.requestId,
        });

        return removed;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});

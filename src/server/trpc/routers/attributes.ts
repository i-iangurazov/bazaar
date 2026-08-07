import { Prisma } from "@prisma/client";
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

const normalizeOptionSet = (values?: string[]) =>
  new Set((values ?? []).map((value) => value.trim()).filter(Boolean));

const collectStoredOptionValues = (value: Prisma.JsonValue): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStoredOptionValues(entry));
  }
  return [];
};

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

  update: managerProcedure.input(definitionUpdateSchema).mutation(async ({ ctx, input }) => {
    try {
      const key = input.key.trim().toLowerCase();
      return await ctx.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "AttributeDefinition"
            WHERE "id" = ${input.id}
              AND "organizationId" = ${ctx.user.organizationId}
            FOR UPDATE
          `);
        if (!locked.length) {
          throw new AppError("attributeNotFound", "NOT_FOUND", 404);
        }

        const existing = await tx.attributeDefinition.findUniqueOrThrow({
          where: { id: input.id },
        });
        const usageValues = await tx.variantAttributeValue.findMany({
          where: { organizationId: ctx.user.organizationId, key: existing.key },
          select: { value: true },
        });

        if (usageValues.length > 0 && input.type !== existing.type) {
          throw new AppError("attributeInUse", "CONFLICT", 409);
        }

        if (usageValues.length > 0 && (input.type === "SELECT" || input.type === "MULTI_SELECT")) {
          const allowed = normalizeOptionSet([
            ...(input.optionsRu ?? []),
            ...(input.optionsKg ?? []),
          ]);
          const removesUsedOption = usageValues.some(({ value }) =>
            collectStoredOptionValues(value).some((stored) => !allowed.has(stored)),
          );
          if (removesUsedOption) {
            throw new AppError("attributeInUse", "CONFLICT", 409);
          }
        }

        if (key !== existing.key) {
          const keyOwner = await tx.attributeDefinition.findUnique({
            where: {
              organizationId_key: {
                organizationId: ctx.user.organizationId,
                key,
              },
            },
            select: { id: true },
          });
          if (keyOwner && keyOwner.id !== existing.id) {
            throw new AppError("attributeExists", "CONFLICT", 409);
          }

          const affectedVariants = await tx.$queryRaw<
            Array<{ id: string; attributes: Prisma.JsonValue }>
          >(
            Prisma.sql`
                SELECT variant."id", variant."attributes"
                FROM "ProductVariant" AS variant
                INNER JOIN "Product" AS product ON product."id" = variant."productId"
                WHERE product."organizationId" = ${ctx.user.organizationId}
                  AND jsonb_typeof(variant."attributes") = 'object'
                  AND variant."attributes" ? ${existing.key}
                ORDER BY variant."id"
                FOR UPDATE OF variant
              `,
          );
          const hasJsonKeyCollision = affectedVariants.some(({ attributes }) => {
            if (!attributes || Array.isArray(attributes) || typeof attributes !== "object") {
              return false;
            }
            return Object.prototype.hasOwnProperty.call(attributes, key);
          });
          if (hasJsonKeyCollision) {
            throw new AppError("attributeExists", "CONFLICT", 409);
          }

          await tx.$executeRaw(Prisma.sql`
              UPDATE "ProductVariant" AS variant
              SET "attributes" =
                    (variant."attributes" - ${existing.key}) ||
                    jsonb_build_object(${key}, variant."attributes" -> ${existing.key}),
                  "updatedAt" = CURRENT_TIMESTAMP
              FROM "Product" AS product
              WHERE product."id" = variant."productId"
                AND product."organizationId" = ${ctx.user.organizationId}
                AND jsonb_typeof(variant."attributes") = 'object'
                AND variant."attributes" ? ${existing.key}
            `);
        }

        const definition = await tx.attributeDefinition.update({
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

        await writeAuditLog(tx, {
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
      });
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

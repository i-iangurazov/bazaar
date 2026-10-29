import { z } from "zod";
import { adminOrOrgOwnerProcedure, rateLimit, router } from "../trpc";
import { toTRPCError } from "../errors";
import { priceBookApplySchema, priceBookRequestSchema } from "@/lib/priceBookContract";
import {
  applyPriceBook,
  compareStorePrices,
  createPriceBook,
  listPriceBooks,
  previewPriceBook,
  readPriceBook,
  reconcilePriceBookAttempt,
  preparePriceBookBulk,
  preparePriceBookFromStore,
} from "@/server/services/priceBooks";

async function safe<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    throw toTRPCError(e);
  }
}
export const priceBooksRouter = router({
  prepareBulk: adminOrOrgOwnerProcedure
    .input(
      z.object({
        bookId: z.string().min(1),
        kind: z.enum(["RETAIL", "WHOLESALE"]),
        mode: z.enum(["SET", "PERCENT", "AMOUNT"]),
        value: z.number().finite().min(-9_999_999_999).max(9_999_999_999),
        productIds: z.array(z.string()).min(1).max(10_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => safe(() => preparePriceBookBulk({ ...input, user: ctx.user }))),
  prepareFromStore: adminOrOrgOwnerProcedure
    .input(
      z.object({
        bookId: z.string().min(1),
        sourceId: z.string().min(1),
        replaceExisting: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      safe(() => preparePriceBookFromStore({ ...input, user: ctx.user })),
    ),
  list: adminOrOrgOwnerProcedure.query(({ ctx }) => safe(() => listPriceBooks(ctx.user))),
  create: adminOrOrgOwnerProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(({ ctx, input }) =>
      safe(() => createPriceBook({ ...input, user: ctx.user, requestId: ctx.requestId })),
    ),
  detail: adminOrOrgOwnerProcedure
    .input(
      z.object({
        bookId: z.string().min(1),
        search: z.string().max(120).optional(),
        page: z.number().int().min(1).max(20000).default(1),
        storeId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => safe(() => readPriceBook({ ...input, user: ctx.user }))),
  preview: adminOrOrgOwnerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "price-book-preview" }))
    .input(priceBookRequestSchema)
    .mutation(({ ctx, input }) => safe(() => previewPriceBook({ ...input, user: ctx.user }))),
  reconcile: adminOrOrgOwnerProcedure
    .input(priceBookApplySchema)
    .mutation(({ ctx, input }) =>
      safe(() => reconcilePriceBookAttempt({ ...input, user: ctx.user, requestId: ctx.requestId })),
    ),
  publish: adminOrOrgOwnerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "price-book-publish" }))
    .input(priceBookApplySchema)
    .mutation(({ ctx, input }) =>
      safe(() => applyPriceBook({ ...input, user: ctx.user, requestId: ctx.requestId })),
    ),
  compare: adminOrOrgOwnerProcedure
    .input(
      z.object({
        sourceId: z.string().min(1),
        targetId: z.string().min(1),
        search: z.string().max(120).optional(),
        onlyDifferences: z.boolean().default(true),
        page: z.number().int().min(1).max(20000).default(1),
      }),
    )
    .query(({ ctx, input }) => safe(() => compareStorePrices({ ...input, user: ctx.user }))),
});

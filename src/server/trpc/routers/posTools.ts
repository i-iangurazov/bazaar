import { z } from "zod";
import { cashierProcedure, router } from "@/server/trpc/trpc";
import { assertUserCanAccessStore, resolveAccessibleStoreIds } from "@/server/services/storeAccess";
import { AppError } from "@/server/services/errors";
import { toTRPCError } from "@/server/trpc/errors";
import { changePosPriceMode } from "@/server/services/posPricing";
import { transferStock } from "@/server/services/inventory";
import { assertFeatureEnabled } from "@/server/services/planLimits";

export const posToolsRouter = router({
  options: cashierProcedure.input(z.object({storeId: z.string()})).query(async ({ctx,input}) => {
    await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
    const [store, actor, ids] = await Promise.all([
      ctx.prisma.store.findUniqueOrThrow({where: {id: input.storeId}, select: {retailWholesaleEnabled: true}}),
      ctx.prisma.user.findUniqueOrThrow({where: {id: ctx.user.id}, select: {canTransferStock: true, isActive: true}}),
      resolveAccessibleStoreIds(ctx.prisma, ctx.user),
    ]);
    const canTransfer = actor.isActive && (["ADMIN","MANAGER"].includes(ctx.user.role) || actor.canTransferStock);
    const stores = canTransfer ? await ctx.prisma.store.findMany({where: {organizationId: ctx.user.organizationId, id: {in: ids, not: input.storeId}}, select: {id: true, name: true}, orderBy: {name: "asc"}}) : [];
    return {priceTypesEnabled: store.retailWholesaleEnabled, canTransfer, stores};
  }),
  changePriceMode: cashierProcedure.input(z.object({saleId: z.string(), mode: z.enum(["RETAIL","WHOLESALE"]), confirmation: z.string().optional(), expectedTotal: z.number().optional()})).mutation(async ({ctx,input}) => {
    try { await assertFeatureEnabled({organizationId: ctx.user.organizationId, feature: "pos"}); return await changePosPriceMode({...input,user:ctx.user,requestId:ctx.requestId}); }
    catch(error) { throw toTRPCError(error); }
  }),
  transfer: cashierProcedure.input(z.object({registerId: z.string(), toStoreId: z.string(), idempotencyKey: z.string().min(8), lines: z.array(z.object({productId:z.string(),variantId:z.string().nullable().optional(),qty:z.number().int().positive()})).min(1).max(100)}).strict()).mutation(async ({ctx,input}) => {
    try {
      await assertFeatureEnabled({organizationId: ctx.user.organizationId, feature: "pos"});
      const actor = await ctx.prisma.user.findFirst({where: {id:ctx.user.id,organizationId:ctx.user.organizationId,isActive:true},select:{canTransferStock:true}});
      if (!actor || (!["ADMIN","MANAGER"].includes(ctx.user.role) && !actor.canTransferStock)) throw new AppError("forbidden","FORBIDDEN",403);
      const register = await ctx.prisma.posRegister.findFirst({where:{id:input.registerId,organizationId:ctx.user.organizationId,isActive:true},select:{storeId:true}});
      if(!register) throw new AppError("storeAccessDenied","FORBIDDEN",403);
      const shift = await ctx.prisma.registerShift.findFirst({ where: { registerId: input.registerId, organizationId: ctx.user.organizationId, status: "OPEN" }, select: { id: true } });
      if (!shift) throw new AppError("posShiftNotOpen", "CONFLICT", 409);
      await assertUserCanAccessStore(ctx.prisma,ctx.user,register.storeId);
      await assertUserCanAccessStore(ctx.prisma,ctx.user,input.toStoreId);
      return await transferStock({organizationId:ctx.user.organizationId,actorId:ctx.user.id,requestId:ctx.requestId,fromStoreId:register.storeId,toStoreId:input.toStoreId,lines:input.lines,idempotencyKey:input.idempotencyKey,respectNegativeStockPolicy:true});
    } catch(error) { throw toTRPCError(error); }
  }),
});

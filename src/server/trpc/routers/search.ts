import { z } from "zod";

import { protectedProcedure, router } from "@/server/trpc/trpc";

export type SearchResult = {
  id: string;
  type: "product" | "supplier" | "store" | "purchaseOrder";
  label: string;
  sublabel?: string | null;
  href: string;
};

export const searchRouter = router({
  global: protectedProcedure
    .input(z.object({ q: z.string().min(2) }))
    .query(async ({ ctx, input }) => {
      const query = input.q.trim();
      if (!query) {
        return { results: [] as SearchResult[] };
      }

      const [products, barcodeMatches, suppliers, stores, purchaseOrders] = await Promise.all([
        ctx.prisma.product.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            isDeleted: false,
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { sku: { contains: query, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, sku: true },
          take: 5,
          orderBy: { name: "asc" },
        }),
        ctx.prisma.productBarcode.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            value: { contains: query, mode: "insensitive" },
          },
          include: { product: true },
          take: 5,
        }),
        ctx.prisma.supplier.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, email: true },
          take: 5,
          orderBy: { name: "asc" },
        }),
        ctx.prisma.store.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { code: { contains: query, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, code: true },
          take: 5,
          orderBy: { name: "asc" },
        }),
        ctx.prisma.purchaseOrder.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            OR: [
              { id: { contains: query, mode: "insensitive" } },
              { supplier: { name: { contains: query, mode: "insensitive" } } },
            ],
          },
          include: {
            supplier: { select: { name: true } },
            store: { select: { name: true } },
          },
          take: 5,
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const productMap = new Map<string, { id: string; name: string; sku: string }>();
      products.forEach((product) => productMap.set(product.id, product));
      barcodeMatches.forEach((match) => {
        if (match.product) {
          productMap.set(match.product.id, {
            id: match.product.id,
            name: match.product.name,
            sku: match.product.sku,
          });
        }
      });

      const results: SearchResult[] = [];
      productMap.forEach((product) => {
        results.push({
          id: product.id,
          type: "product",
          label: product.name,
          sublabel: product.sku,
          href: `/products/${product.id}`,
        });
      });

      suppliers.forEach((supplier) => {
        results.push({
          id: supplier.id,
          type: "supplier",
          label: supplier.name,
          sublabel: supplier.email ?? null,
          href: `/suppliers`,
        });
      });

      stores.forEach((store) => {
        results.push({
          id: store.id,
          type: "store",
          label: store.name,
          sublabel: store.code ?? null,
          href: `/stores`,
        });
      });

      purchaseOrders.forEach((order) => {
        results.push({
          id: order.id,
          type: "purchaseOrder",
          label: order.id.slice(0, 8).toUpperCase(),
          sublabel: `${order.supplier.name} • ${order.store.name}`,
          href: `/purchase-orders/${order.id}`,
        });
      });

      return { results };
    }),
});

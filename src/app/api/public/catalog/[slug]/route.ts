import { getPublicBazaarCatalog } from "@/server/services/bazaarCatalog";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publicCatalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(200).optional(),
  productIds: z.array(z.string().trim().min(1).max(191)).max(100).default([]),
});

export const GET = async (
  request: Request,
  context: { params: Promise<{ slug: string }> },
) => {
  const { slug } = await context.params;
  const url = new URL(request.url);
  const parsed = publicCatalogQuerySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    productIds: url.searchParams.getAll("productId"),
  });
  if (!parsed.success) {
    return Response.json({ message: "validationError" }, { status: 400 });
  }
  const payload = await getPublicBazaarCatalog(slug, parsed.data);
  if (!payload) {
    return Response.json({ message: "catalogNotFound" }, { status: 404 });
  }
  return Response.json(payload, { status: 200 });
};

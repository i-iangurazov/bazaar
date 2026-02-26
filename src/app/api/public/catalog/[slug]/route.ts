import { getPublicBazaarCatalog } from "@/server/services/bazaarCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async (_request: Request, context: { params: { slug: string } }) => {
  const slug = context.params.slug;
  const payload = await getPublicBazaarCatalog(slug);
  if (!payload) {
    return Response.json({ message: "catalogNotFound" }, { status: 404 });
  }
  return Response.json(payload, { status: 200 });
};

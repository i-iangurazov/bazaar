import { z } from "zod";

import {
  authenticateBazaarApiRequest,
  listBazaarApiProducts,
} from "@/server/services/bazaarApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  search: z.string().trim().max(200).optional().nullable(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const toStatus = (message: string) => {
  if (message === "apiUnauthorized") {
    return 401;
  }
  if (message === "storeNotFound") {
    return 404;
  }
  return 500;
};

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    search: url.searchParams.get("search"),
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  try {
    const auth = await authenticateBazaarApiRequest(request);
    const result = await listBazaarApiProducts({
      organizationId: auth.organizationId,
      storeId: auth.storeId,
      search: parsed.data.search,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "genericMessage";
    return Response.json({ message }, { status: toStatus(message) });
  }
};

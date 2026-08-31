import { authenticateBazaarApiRequest, getBazaarApiOrder } from "@/server/services/bazaarApi";
import { mapBazaarApiError } from "@/app/api/bazaar/v1/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{
    id: string;
  }>;
};

const errorBody = (message: string) => {
  if (message === "orderNotFound") {
    return { error: "NOT_FOUND" };
  }
  return { message };
};

export const GET = async (request: Request, { params }: RouteParams) => {
  try {
    const { id } = await params;
    const auth = await authenticateBazaarApiRequest(request);
    const order = await getBazaarApiOrder({
      organizationId: auth.organizationId,
      storeId: auth.storeId,
      identifier: id,
    });
    return Response.json({ order }, { status: 200 });
  } catch (error) {
    const mapped = mapBazaarApiError(error, "orders.get");
    return Response.json(errorBody(mapped.message), { status: mapped.status });
  }
};
